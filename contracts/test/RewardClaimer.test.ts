import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

interface Entry {
  index: number;
  account: string;
  amount: bigint;
}

function leafFor(entry: Entry): Buffer {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"],
    [entry.index, entry.account, entry.amount]
  );
  const inner = ethers.keccak256(encoded);
  const outer = ethers.keccak256(inner);
  return Buffer.from(outer.slice(2), "hex");
}

describe("RewardClaimer", () => {
  async function deploy() {
    const [owner, relayer, alice, bob] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("RWAForge", "FORGE", 18);
    await token.waitForDeployment();

    const RewardClaimer = await ethers.getContractFactory("RewardClaimer");
    const claimer = await RewardClaimer.deploy(await token.getAddress(), owner.address);
    await claimer.waitForDeployment();

    const entries: Entry[] = [
      { index: 0, account: alice.address, amount: ethers.parseEther("100") },
      { index: 1, account: bob.address, amount: ethers.parseEther("50") },
    ];

    const leaves = entries.map(leafFor);
    const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
    const root = tree.getHexRoot();

    await token.mint(await claimer.getAddress(), ethers.parseEther("1000"));
    await claimer.connect(owner).updateMerkleRoot(root);

    const proofFor = (i: number) => tree.getHexProof(leaves[i]);

    return { claimer, token, owner, relayer, alice, bob, entries, proofFor, root };
  }

  it("allows self-service claim with a valid proof", async () => {
    const { claimer, token, alice, entries, proofFor } = await deploy();
    const entry = entries[0];

    await expect(
      claimer.connect(alice).claim(entry.index, entry.amount, proofFor(entry.index))
    ).to.emit(claimer, "Claimed");

    expect(await token.balanceOf(alice.address)).to.equal(entry.amount);
    expect(await claimer.isClaimed(entry.index)).to.equal(true);
  });

  it("rejects an invalid proof", async () => {
    const { claimer, entries, proofFor } = await deploy();
    const entry = entries[0];
    const wrongProof = proofFor(1); // proof for bob's leaf, used against alice's claim

    await expect(
      claimer.claim(entry.index, entry.amount, wrongProof)
    ).to.be.revertedWithCustomError(claimer, "InvalidProof");
  });

  it("rejects double claims", async () => {
    const { claimer, alice, entries, proofFor } = await deploy();
    const entry = entries[0];
    await claimer.connect(alice).claim(entry.index, entry.amount, proofFor(entry.index));

    await expect(
      claimer.connect(alice).claim(entry.index, entry.amount, proofFor(entry.index))
    ).to.be.revertedWithCustomError(claimer, "AlreadyClaimed");
  });

  it("lets a relayer claim on behalf of the recipient via claimFor", async () => {
    const { claimer, token, relayer, bob, entries, proofFor } = await deploy();
    const entry = entries[1];

    await expect(
      claimer.connect(relayer).claimFor(entry.index, bob.address, entry.amount, proofFor(entry.index))
    )
      .to.emit(claimer, "Claimed")
      .withArgs(1n, entry.index, bob.address, entry.amount, relayer.address);

    // Funds go to bob, not the relayer who paid gas.
    expect(await token.balanceOf(bob.address)).to.equal(entry.amount);
    expect(await token.balanceOf(relayer.address)).to.equal(0n);
  });

  it("resets claim status on a new epoch", async () => {
    const { claimer, owner, alice, entries, proofFor, root } = await deploy();
    const entry = entries[0];
    await claimer.connect(alice).claim(entry.index, entry.amount, proofFor(entry.index));

    // Re-publishing the same root starts a new epoch; the same index is claimable again.
    await claimer.connect(owner).updateMerkleRoot(root);
    expect(await claimer.isClaimed(entry.index)).to.equal(false);

    await expect(
      claimer.connect(alice).claim(entry.index, entry.amount, proofFor(entry.index))
    ).to.emit(claimer, "Claimed");
  });
});
