# Demo: Blue-Green Deployment & Distributed Behavior

## Command Used
./blue-green-swap.sh replica3

## Observed Output
- Replica stopped successfully
- Container removed
- New container started
- Logs streamed correctly

## Key Logs
=== Blue-Green Swap: replica3 ===
Step 1: Stopping replica3...
Step 2: Removing container...
Step 3: Starting fresh replica3...
Step 4: Watching logs...

{"event":"REPLICA_STARTED","id":"r3","role":"follower"}
{"event":"TRANSITION_TO_FOLLOWER","newLeader":"r2"}

## Distributed System Validation
- 3 replicas in cluster
- Leader election works
- On leader failure, new leader is elected
- Restarted replica rejoins as follower

## Conclusion
System demonstrates distributed coordination and fault tolerance using RAFT.
