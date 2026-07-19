// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProofOfSunlight} from "../src/ProofOfSunlight.sol";

contract ProofOfSunlightTest is Test {
    ProofOfSunlight pos;
    address longhorn = makeAddr("longhorn-01");
    address stranger = makeAddr("stranger");

    function setUp() public {
        pos = new ProofOfSunlight();
        pos.registerNode(longhorn, "LONGHORN-01");
    }

    function test_RegisterAndPost() public {
        vm.prank(longhorn);
        vm.expectEmit(true, true, false, true);
        emit ProofOfSunlight.Epoch(longhorn, 1, 1426, 83, 1287, 600, block.timestamp);
        pos.postEpoch(1426, 83, 1287, 600);

        (string memory name,, uint64 count,, uint32 solarDw, uint8 batt,,) = pos.latest(longhorn);
        assertEq(name, "LONGHORN-01");
        assertEq(count, 1);
        assertEq(solarDw, 1426);
        assertEq(batt, 83);
    }

    function test_StrangerCannotPost() public {
        vm.prank(stranger);
        vm.expectRevert(ProofOfSunlight.NotNode.selector);
        pos.postEpoch(1, 1, 1, 1);
    }

    function test_OnlyOwnerRegisters() public {
        vm.prank(stranger);
        vm.expectRevert(ProofOfSunlight.NotOwner.selector);
        pos.registerNode(stranger, "FAKE");
    }

    function test_RateLimit() public {
        vm.startPrank(longhorn);
        pos.postEpoch(100, 50, 0, 600);
        vm.expectRevert(ProofOfSunlight.TooSoon.selector);
        pos.postEpoch(100, 50, 0, 600);
        // after MIN_INTERVAL it works again
        vm.warp(block.timestamp + pos.MIN_INTERVAL());
        pos.postEpoch(101, 51, 5, 600);
        vm.stopPrank();
        (,, uint64 count,,,,,) = pos.latest(longhorn);
        assertEq(count, 2);
    }

    function test_BadReadingsRejected() public {
        vm.startPrank(longhorn);
        vm.expectRevert(ProofOfSunlight.BadReading.selector);
        pos.postEpoch(1, 101, 0, 0); // battery > 100%
        vm.expectRevert(ProofOfSunlight.BadReading.selector);
        pos.postEpoch(50_001, 50, 0, 0); // > 5 kW from a "small" node
        vm.stopPrank();
    }

    function test_RetiredNodeCannotPost() public {
        pos.retireNode(longhorn);
        vm.prank(longhorn);
        vm.expectRevert(ProofOfSunlight.NotNode.selector);
        pos.postEpoch(1, 1, 1, 1);
    }

    function test_CannotReRegister() public {
        vm.expectRevert(ProofOfSunlight.AlreadyRegistered.selector);
        pos.registerNode(longhorn, "CLONE");
        // even after retirement (history must stay bound to one name)
        pos.retireNode(longhorn);
        vm.prank(longhorn);
        vm.warp(block.timestamp + 600);
        vm.expectRevert(ProofOfSunlight.NotNode.selector);
        pos.postEpoch(1, 1, 1, 1);
    }

    function test_OwnershipTransfer() public {
        pos.transferOwnership(stranger);
        assertEq(pos.owner(), stranger);
        vm.expectRevert(ProofOfSunlight.NotOwner.selector);
        pos.registerNode(makeAddr("maverick-02"), "MAVERICK-02");
        vm.prank(stranger);
        pos.registerNode(makeAddr("maverick-02"), "MAVERICK-02");
        assertEq(pos.nodeCount(), 2);
    }

    function testFuzz_PostWithinBounds(uint32 solarDw, uint8 batt, uint32 served, uint32 uptime) public {
        solarDw = uint32(bound(solarDw, 0, pos.MAX_SOLAR_DW()));
        batt = uint8(bound(batt, 0, 100));
        vm.prank(longhorn);
        pos.postEpoch(solarDw, batt, served, uptime);
        (,, uint64 count,, uint32 gotDw, uint8 gotBatt, uint32 gotServed, uint32 gotUptime) = pos.latest(longhorn);
        assertEq(count, 1);
        assertEq(gotDw, solarDw);
        assertEq(gotBatt, batt);
        assertEq(gotServed, served);
        assertEq(gotUptime, uptime);
    }
}
