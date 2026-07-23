// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PredictVault
/// @notice Escrow contract on Robinhood Chain that locks a user's tokenized RWA/stock tokens
///         as collateral for a Polymarket prediction market position on Polygon.
///
///         Flow:
///         1. User calls `lockCollateral`. A booking fee (default 0.5%) is deducted immediately
///            and sent to feeRecipient. Net collateral is held in this contract.
///         2. The off-chain operator agent bridges equivalent USDC to Polygon via LayerZero
///            and places the Polymarket CLOB order on the user's behalf.
///         3a. WIN: operator bridges USDC winnings back, swaps to stock token on RH Chain DEX,
///             approves this contract, then calls `settleWin`. A win fee (default 2%) is
///             deducted from the payout and sent to feeRecipient. Remaining payout goes to user.
///         3b. LOSS: operator calls `settleLoss`. Net collateral stays in vault; governance
///             sweeps it to treasury via `sweepLosses`.
///
///         Fee revenue: booking fee (immediate, on lock) + win fee (on settlement).
///         At 0.5% booking + 2% win fee, $300k volume → ~$2.5k–$3k protocol revenue.
contract PredictVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_BOOKING_FEE_BPS = 200;  // 2% hard cap
    uint256 public constant MAX_WIN_FEE_BPS = 500;      // 5% hard cap

    enum PositionStatus { Active, WonPaid, Lost, Cancelled }

    struct Position {
        address user;
        address token;
        uint256 netAmount;      // collateral held after booking fee
        bytes32 marketId;       // Polymarket conditionId
        uint8 outcomeIndex;     // 0 = YES, 1 = NO
        PositionStatus status;
        uint256 payoutAmount;   // gross payout before win fee (filled on settleWin)
    }

    address public operator;
    address public feeRecipient;

    /// @notice Booking fee deducted from collateral at lock time (default 50 = 0.5%).
    uint256 public bookingFeeBps = 50;
    /// @notice Win fee deducted from total payout on a winning settlement (default 200 = 2%).
    uint256 public winFeeBps = 200;

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    event CollateralLocked(
        uint256 indexed positionId,
        address indexed user,
        address token,
        uint256 grossAmount,
        uint256 bookingFee,
        uint256 netAmount,
        bytes32 marketId,
        uint8 outcomeIndex
    );
    event WinSettled(
        uint256 indexed positionId,
        address indexed user,
        uint256 grossPayout,
        uint256 winFee,
        uint256 userPayout
    );
    event LossSettled(uint256 indexed positionId, address indexed user);
    event PositionCancelled(uint256 indexed positionId, address indexed user);
    event BookingFeeBpsUpdated(uint256 previous, uint256 updated);
    event WinFeeBpsUpdated(uint256 previous, uint256 updated);
    event FeeRecipientUpdated(address previous, address updated);

    error NotOperator();
    error PositionNotActive(uint256 positionId);
    error ZeroAmount();
    error ZeroAddress();
    error FeeOutOfBounds();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(address initialOwner, address operator_, address feeRecipient_)
        Ownable(initialOwner)
    {
        if (operator_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        operator = operator_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Lock RWA/stock tokens as collateral. A booking fee is taken immediately.
    /// @param token       Tokenized stock/RWA on RH Chain to use as collateral.
    /// @param grossAmount Total amount of `token` to deposit (including booking fee).
    /// @param marketId    Polymarket conditionId for the target market.
    /// @param outcomeIndex 0 = YES, 1 = NO.
    /// @return positionId ID of the created position.
    function lockCollateral(
        address token,
        uint256 grossAmount,
        bytes32 marketId,
        uint8 outcomeIndex
    ) external nonReentrant returns (uint256 positionId) {
        if (grossAmount == 0) revert ZeroAmount();
        if (token == address(0)) revert ZeroAddress();

        uint256 bookingFee = (grossAmount * bookingFeeBps) / BPS_DENOMINATOR;
        uint256 netAmount = grossAmount - bookingFee;

        positionId = nextPositionId++;
        positions[positionId] = Position({
            user: msg.sender,
            token: token,
            netAmount: netAmount,
            marketId: marketId,
            outcomeIndex: outcomeIndex,
            status: PositionStatus.Active,
            payoutAmount: 0
        });

        IERC20(token).safeTransferFrom(msg.sender, address(this), grossAmount);
        if (bookingFee > 0) {
            IERC20(token).safeTransfer(feeRecipient, bookingFee);
        }

        emit CollateralLocked(
            positionId, msg.sender, token, grossAmount, bookingFee, netAmount, marketId, outcomeIndex
        );
    }

    /// @notice Settle a winning position. Operator must have pre-approved this contract for
    ///         `grossPayout` of `position.token` before calling.
    /// @param positionId  The position to settle.
    /// @param grossPayout Gross token amount to pay out (collateral + converted winnings).
    ///                    Win fee is deducted from this before sending to the user.
    function settleWin(uint256 positionId, uint256 grossPayout)
        external
        nonReentrant
        onlyOperator
    {
        Position storage pos = positions[positionId];
        if (pos.status != PositionStatus.Active) revert PositionNotActive(positionId);

        uint256 winFee = (grossPayout * winFeeBps) / BPS_DENOMINATOR;
        uint256 userPayout = grossPayout - winFee;

        pos.status = PositionStatus.WonPaid;
        pos.payoutAmount = grossPayout;

        // Operator pre-transfers grossPayout to this contract; we distribute from here.
        IERC20(pos.token).safeTransferFrom(msg.sender, address(this), grossPayout);
        if (winFee > 0) {
            IERC20(pos.token).safeTransfer(feeRecipient, winFee);
        }
        // Return net collateral + net winnings to user (netAmount was already held here;
        // grossPayout includes the replacement of netAmount, so send userPayout total).
        IERC20(pos.token).safeTransfer(pos.user, userPayout);

        emit WinSettled(positionId, pos.user, grossPayout, winFee, userPayout);
    }

    /// @notice Settle a losing position. Collateral stays in vault until swept to treasury.
    function settleLoss(uint256 positionId) external onlyOperator {
        Position storage pos = positions[positionId];
        if (pos.status != PositionStatus.Active) revert PositionNotActive(positionId);
        pos.status = PositionStatus.Lost;
        emit LossSettled(positionId, pos.user);
    }

    /// @notice Cancel a position and refund net collateral to the user.
    ///         Booking fee is non-refundable (operator already used it for bridging gas).
    function cancelPosition(uint256 positionId) external nonReentrant onlyOperator {
        Position storage pos = positions[positionId];
        if (pos.status != PositionStatus.Active) revert PositionNotActive(positionId);
        pos.status = PositionStatus.Cancelled;
        IERC20(pos.token).safeTransfer(pos.user, pos.netAmount);
        emit PositionCancelled(positionId, pos.user);
    }

    /// @notice Move lost collateral to a destination address (treasury).
    function sweepLosses(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    // --- Admin ---

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        operator = newOperator;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setBookingFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_BOOKING_FEE_BPS) revert FeeOutOfBounds();
        emit BookingFeeBpsUpdated(bookingFeeBps, bps);
        bookingFeeBps = bps;
    }

    function setWinFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_WIN_FEE_BPS) revert FeeOutOfBounds();
        emit WinFeeBpsUpdated(winFeeBps, bps);
        winFeeBps = bps;
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }
}
