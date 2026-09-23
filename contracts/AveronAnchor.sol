// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title Averon Chain Anchor
/// @notice Anchors Averon's inbuilt blockchain state to Polygon for public verifiability
/// @dev Each Averon block's Merkle root + hash is stored on-chain, allowing anyone
///      to verify that Averon's chain hasn't been tampered with.
contract AveronAnchor {
    struct Anchor {
        bytes32 merkleRoot;    // Merkle root of all transactions in the Averon block
        bytes32 blockHash;      // SHA-256 hash of the Averon block
        uint256 timestamp;      // When anchored on Polygon
        address anchoredBy;     // Who submitted the anchor
    }

    mapping(uint256 => Anchor) public anchors;  // averonBlockIndex → Anchor
    uint256 public latestBlockIndex;             // latest anchored block

    event BlockAnchored(
        uint256 indexed averonBlockIndex,
        bytes32 merkleRoot,
        bytes32 blockHash,
        uint256 timestamp,
        address anchoredBy
    );

    /// @notice Anchor an Averon block's Merkle root + hash
    /// @param blockIndex The Averon block index (e.g., 0, 1, 2, ...)
    /// @param merkleRoot The Merkle root of all transactions in this block
    /// @param blockHash The SHA-256 hash of this block
    function anchor(
        uint256 blockIndex,
        bytes32 merkleRoot,
        bytes32 blockHash
    ) external {
        require(anchors[blockIndex].timestamp == 0, "Block already anchored");
        require(blockIndex > latestBlockIndex || blockIndex == 0, "Block index must be newer");

        anchors[blockIndex] = Anchor({
            merkleRoot: merkleRoot,
            blockHash: blockHash,
            timestamp: block.timestamp,
            anchoredBy: msg.sender
        });

        latestBlockIndex = blockIndex;

        emit BlockAnchored(blockIndex, merkleRoot, blockHash, block.timestamp, msg.sender);
    }

    /// @notice Get the anchor for a specific Averon block
    /// @param blockIndex The Averon block index
    /// @return merkleRoot, blockHash, timestamp, anchoredBy
    function getAnchor(uint256 blockIndex) external view returns (
        bytes32 merkleRoot,
        bytes32 blockHash,
        uint256 timestamp,
        address anchoredBy
    ) {
        Anchor memory a = anchors[blockIndex];
        return (a.merkleRoot, a.blockHash, a.timestamp, a.anchoredBy);
    }

    /// @notice Get the latest anchored block
    /// @return blockIndex, merkleRoot, blockHash, timestamp
    function getLatestAnchor() external view returns (
        uint256 blockIndex,
        bytes32 merkleRoot,
        bytes32 blockHash,
        uint256 timestamp
    ) {
        Anchor memory a = anchors[latestBlockIndex];
        return (latestBlockIndex, a.merkleRoot, a.blockHash, a.timestamp);
    }

    /// @notice Verify that a local block matches the anchored one
    /// @param blockIndex The Averon block index
    /// @param merkleRoot The Merkle root to verify
    /// @param blockHash The block hash to verify
    /// @return True if the provided values match the anchored ones
    function verify(
        uint256 blockIndex,
        bytes32 merkleRoot,
        bytes32 blockHash
    ) external view returns (bool) {
        Anchor memory a = anchors[blockIndex];
        if (a.timestamp == 0) return false;
        return a.merkleRoot == merkleRoot && a.blockHash == blockHash;
    }
}
