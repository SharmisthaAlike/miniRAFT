# miniRAFT - Distributed System with Blue-Green Deployment

## Overview
miniRAFT is a distributed system implementing the RAFT consensus algorithm using multiple replicas.  
It demonstrates leader election, fault tolerance, and service recovery using a blue-green style deployment script.

---

## Architecture

The system consists of:

- 3 replicas:
  - replica1 (port 3001)
  - replica2 (port 3002)
  - replica3 (port 3003)
- Gateway (entry point)
- Frontend (client interface)

Each replica communicates with others to maintain consensus.

---

## Technologies Used

- Node.js
- Docker & Docker Compose
- RAFT Consensus Algorithm
- Nodemon (for live reload)

---

## Key Features

### 1. Leader Election
- One replica is elected as leader
- Others act as followers
- Election occurs automatically on failure

### 2. Fault Tolerance
- If leader crashes, a new leader is elected
- System continues functioning without downtime

### 3. Blue-Green Deployment
A script is used to safely restart replicas without affecting the cluster.

---

## Blue-Green Script

### Usage
```bash
./blue-green-swap.sh replica1
