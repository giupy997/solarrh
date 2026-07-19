// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Proof of Sunlight — telemetry registry for Solar Ranch nodes
/// @notice Each registered node posts a signed reading ("epoch") every ~10 minutes.
///         The transaction signature IS the node's signature: postEpoch() only
///         accepts msg.sender values registered by the owner. History lives in
///         events (cheap to emit, easy to index from the site via eth_getLogs);
///         the latest reading per node is kept in storage for one-call reads.
contract ProofOfSunlight {
    struct Node {
        string name;         // e.g. "LONGHORN-01"
        bool active;
        uint64 epochCount;
        uint64 lastPostedAt;
        uint32 lastSolarDw;  // deciwatts (142.6 W -> 1426) to keep one decimal
        uint8 lastBatteryPct;
        uint32 lastServedMb;
        uint32 lastUptimeS;
    }

    /// @dev Sanity caps: a "small solar node" reading beyond these is a bug or a lie.
    uint32 public constant MAX_SOLAR_DW = 50_000; // 5 kW
    uint256 public constant MIN_INTERVAL = 5 minutes;

    address public owner;
    address[] public nodeList;
    mapping(address => Node) public nodes;

    event NodeRegistered(address indexed key, string name);
    event NodeRetired(address indexed key);
    event OwnershipTransferred(address indexed from, address indexed to);
    event Epoch(
        address indexed node,
        uint64 indexed epoch,
        uint32 solarDw,
        uint8 batteryPct,
        uint32 servedMb,
        uint32 uptimeS,
        uint256 timestamp
    );

    error NotOwner();
    error NotNode();
    error AlreadyRegistered();
    error TooSoon();
    error BadReading();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // ---------- ranch management ----------

    function registerNode(address key, string calldata name) external onlyOwner {
        if (key == address(0)) revert ZeroAddress();
        if (nodes[key].active || nodes[key].epochCount > 0) revert AlreadyRegistered();
        nodes[key].name = name;
        nodes[key].active = true;
        nodeList.push(key);
        emit NodeRegistered(key, name);
    }

    /// @notice A retired node keeps its history but can no longer post.
    function retireNode(address key) external onlyOwner {
        if (!nodes[key].active) revert NotNode();
        nodes[key].active = false;
        emit NodeRetired(key);
    }

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }

    // ---------- the node speaks ----------

    function postEpoch(uint32 solarDw, uint8 batteryPct, uint32 servedMb, uint32 uptimeS) external {
        Node storage n = nodes[msg.sender];
        if (!n.active) revert NotNode();
        if (n.lastPostedAt != 0 && block.timestamp < uint256(n.lastPostedAt) + MIN_INTERVAL) revert TooSoon();
        if (batteryPct > 100 || solarDw > MAX_SOLAR_DW) revert BadReading();

        n.epochCount += 1;
        n.lastPostedAt = uint64(block.timestamp);
        n.lastSolarDw = solarDw;
        n.lastBatteryPct = batteryPct;
        n.lastServedMb = servedMb;
        n.lastUptimeS = uptimeS;

        emit Epoch(msg.sender, n.epochCount, solarDw, batteryPct, servedMb, uptimeS, block.timestamp);
    }

    // ---------- reads for the site ----------

    function nodeCount() external view returns (uint256) {
        return nodeList.length;
    }

    function latest(address key)
        external
        view
        returns (
            string memory name,
            bool active,
            uint64 epochCount,
            uint64 lastPostedAt,
            uint32 solarDw,
            uint8 batteryPct,
            uint32 servedMb,
            uint32 uptimeS
        )
    {
        Node storage n = nodes[key];
        return (
            n.name,
            n.active,
            n.epochCount,
            n.lastPostedAt,
            n.lastSolarDw,
            n.lastBatteryPct,
            n.lastServedMb,
            n.lastUptimeS
        );
    }
}
