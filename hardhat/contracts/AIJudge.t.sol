// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIJudge} from "./AIJudge.sol";

contract AIJudgeTest is Test {
    AIJudge judge;
    address owner;
    address alice;
    address bob;
    address carol;

    uint256 bountyId;
    uint256 submissionDeadline;
    uint256 revealDeadline;

    function setUp() public {
        judge = new AIJudge();
        owner = vm.addr(1);
        alice = vm.addr(2);
        bob = vm.addr(3);
        carol = vm.addr(4);
        vm.deal(owner, 10 ether);
        vm.deal(alice, 1 ether);
        vm.deal(bob, 1 ether);
        vm.deal(carol, 1 ether);

        submissionDeadline = block.timestamp + 1 hours;
        revealDeadline = submissionDeadline + 1 hours;

        vm.prank(owner);
        bountyId = judge.createBounty{value: 1 ether}(
            "Test Bounty",
            "Score on clarity and correctness",
            submissionDeadline,
            revealDeadline
        );
    }

    function _commitment(
        uint256 id,
        string memory answer,
        bytes32 salt,
        address submitter
    ) internal view returns (bytes32) {
        return judge.computeCommitment(id, answer, salt, submitter);
    }

    function test_CreateBountyStoresDeadlines() public view {
        (
            address bOwner,
            ,
            ,
            uint256 reward,
            uint256 subDeadline,
            uint256 revDeadline,
            bool judged,
            bool finalized,
            uint256 submissionCount,
            uint256 revealedCount,
            ,
        ) = judge.getBounty(bountyId);

        assertEq(bOwner, owner);
        assertEq(reward, 1 ether);
        assertEq(subDeadline, submissionDeadline);
        assertEq(revDeadline, revealDeadline);
        assertFalse(judged);
        assertFalse(finalized);
        assertEq(submissionCount, 0);
        assertEq(revealedCount, 0);
    }

    function test_SubmitCommitmentDuringSubmissionPhase() public {
        bytes32 salt = keccak256("alice-salt");
        bytes32 commitment = _commitment(bountyId, "Alice answer", salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        (
            address submitter,
            bytes32 storedCommitment,
            bool revealed,
            string memory answer
        ) = judge.getSubmission(bountyId, 0);

        assertEq(submitter, alice);
        assertEq(storedCommitment, commitment);
        assertFalse(revealed);
        assertEq(answer, "");
        assertTrue(judge.hasCommitted(bountyId, alice));
    }

    function test_RevealAnswerAfterSubmissionDeadline() public {
        bytes32 salt = keccak256("alice-salt");
        string memory answerText = "Alice answer";
        bytes32 commitment = _commitment(bountyId, answerText, salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.warp(submissionDeadline);

        vm.prank(alice);
        judge.revealAnswer(bountyId, answerText, salt);

        (
            ,
            ,
            bool revealed,
            string memory answer
        ) = judge.getSubmission(bountyId, 0);

        assertTrue(revealed);
        assertEq(answer, answerText);

        (, , , , , , , , , uint256 revealedCount, , ) = judge.getBounty(
            bountyId
        );
        assertEq(revealedCount, 1);
    }

    function test_RevertRevealBeforeSubmissionDeadline() public {
        bytes32 salt = keccak256("alice-salt");
        string memory answerText = "Alice answer";
        bytes32 commitment = _commitment(bountyId, answerText, salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.prank(alice);
        vm.expectRevert("submission phase not ended");
        judge.revealAnswer(bountyId, answerText, salt);
    }

    function test_RevertRevealAfterRevealDeadline() public {
        bytes32 salt = keccak256("alice-salt");
        string memory answerText = "Alice answer";
        bytes32 commitment = _commitment(bountyId, answerText, salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.warp(revealDeadline);

        vm.prank(alice);
        vm.expectRevert("reveal phase closed");
        judge.revealAnswer(bountyId, answerText, salt);
    }

    function test_RevertInvalidRevealWithWrongSalt() public {
        bytes32 salt = keccak256("alice-salt");
        bytes32 commitment = _commitment(bountyId, "Alice answer", salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.warp(submissionDeadline);

        vm.prank(alice);
        vm.expectRevert("invalid reveal");
        judge.revealAnswer(bountyId, "Alice answer", keccak256("wrong-salt"));
    }

    function test_RevertInvalidRevealWithWrongAnswer() public {
        bytes32 salt = keccak256("alice-salt");
        bytes32 commitment = _commitment(bountyId, "Alice answer", salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.warp(submissionDeadline);

        vm.prank(alice);
        vm.expectRevert("invalid reveal");
        judge.revealAnswer(bountyId, "Copied answer", salt);
    }

    function test_RevertCommitmentAfterSubmissionDeadline() public {
        vm.warp(submissionDeadline);

        vm.prank(alice);
        vm.expectRevert("submission phase closed");
        judge.submitCommitment(bountyId, keccak256("late"));
    }

    function test_RevertDuplicateCommitmentFromSameAddress() public {
        vm.prank(alice);
        judge.submitCommitment(bountyId, keccak256("first"));

        vm.prank(alice);
        vm.expectRevert("already committed");
        judge.submitCommitment(bountyId, keccak256("second"));
    }

    function test_RevertJudgeAllBeforeRevealDeadline() public {
        bytes32 salt = keccak256("alice-salt");
        string memory answerText = "Alice answer";
        bytes32 commitment = _commitment(bountyId, answerText, salt, alice);

        vm.prank(alice);
        judge.submitCommitment(bountyId, commitment);

        vm.warp(submissionDeadline);

        vm.prank(alice);
        judge.revealAnswer(bountyId, answerText, salt);

        vm.prank(owner);
        vm.expectRevert("reveal phase not ended");
        judge.judgeAll(bountyId, bytes(""));
    }

    function test_RevertJudgeAllWithNoRevealedSubmissions() public {
        bytes32 salt = keccak256("alice-salt");

        vm.prank(alice);
        judge.submitCommitment(
            bountyId,
            _commitment(bountyId, "Alice answer", salt, alice)
        );

        vm.warp(revealDeadline);

        vm.prank(owner);
        vm.expectRevert("no revealed submissions");
        judge.judgeAll(bountyId, bytes(""));
    }

    function test_CommitmentBindsSubmitterAndBountyId() public {
        bytes32 salt = keccak256("shared-salt");
        string memory answerText = "Shared answer";

        bytes32 aliceCommitment = _commitment(
            bountyId,
            answerText,
            salt,
            alice
        );
        bytes32 bobCommitment = _commitment(bountyId, answerText, salt, bob);

        assertTrue(aliceCommitment != bobCommitment);

        vm.prank(alice);
        judge.submitCommitment(bountyId, aliceCommitment);

        vm.warp(submissionDeadline);

        vm.prank(bob);
        vm.expectRevert("no commitment found");
        judge.revealAnswer(bountyId, answerText, salt);
    }

    function test_UnrevealedSubmissionsNotCountedAsRevealed() public {
        bytes32 aliceSalt = keccak256("alice-salt");
        bytes32 bobSalt = keccak256("bob-salt");

        vm.startPrank(alice);
        judge.submitCommitment(
            bountyId,
            _commitment(bountyId, "Alice answer", aliceSalt, alice)
        );
        vm.stopPrank();

        vm.startPrank(bob);
        judge.submitCommitment(
            bountyId,
            _commitment(bountyId, "Bob answer", bobSalt, bob)
        );
        vm.stopPrank();

        vm.warp(submissionDeadline);

        vm.prank(alice);
        judge.revealAnswer(bountyId, "Alice answer", aliceSalt);

        (, , , , , , , , , uint256 revealedCount, , ) = judge.getBounty(
            bountyId
        );
        assertEq(revealedCount, 1);
    }
}