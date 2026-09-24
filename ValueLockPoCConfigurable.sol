// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "./Multicall3.sol";

/// @notice Contract with NO receive/fallback - any plain USDC transfer to it reverts.
contract Rejector {
    // intentionally empty
}

/// @notice Contract that accepts USDC normally.
contract Accepter {
    event Received(uint256 amount);
    receive() external payable {
        emit Received(msg.value);
    }
}

/// @notice Drives the scenario. Amounts are passed in at call time, not hardcoded,
///         so you can size this to whatever testnet ETH you actually have.
contract ValueLockPoCConfigurable {
    MultiCall3 public mc3;
    Rejector public rejector;
    Accepter public accepter;

    constructor(address _mc3) {
        mc3 = MultiCall3(_mc3);
        rejector = new Rejector();
        accepter = new Accepter();
    }

    /// @param failingAmount   USDC sent to the rejecting contract (allowFailure=true)
    /// @param succeedingAmount USDC sent to the accepting contract (allowFailure=false)
    /// @dev msg.value MUST equal failingAmount + succeedingAmount exactly,
    ///      or MultiCall3's internal "value mismatch" check reverts the whole tx.
    function run(uint256 failingAmount, uint256 succeedingAmount) external payable {
        require(msg.value == failingAmount + succeedingAmount, "PoC: msg.value must equal failingAmount + succeedingAmount");

        MultiCall3.Call3Value[] memory calls = new MultiCall3.Call3Value[](2);

        calls[0] = MultiCall3.Call3Value({
            target: address(rejector),
            allowFailure: true,
            value: failingAmount,
            callData: ""
        });

        calls[1] = MultiCall3.Call3Value({
            target: address(accepter),
            allowFailure: false,
            value: succeedingAmount,
            callData: ""
        });

        mc3.aggregate3Value{value: msg.value}(calls);
    }
}