# token-radar-01-v2

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Alro07/token-radar-01-v2/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Alro07/token-radar-01-v2/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar, rebuilt from the model up. It reads a sealed DefiLlama snapshot of 758 protocols, covers the whole 40-protocol watchlist, adds 138 rankable pre-token protocols below the $50M floor, and ranks all 178 by an implied value from the snapshot's own figures — TVL, seven-day growth and time running with no token — under the radar-3 model: declines hurt more than growth helps, maturity saturates, and multi-chain reach is capped at +10%. Every row carries a seven-step farm plan with costs and times, the dashboard ranks movers by dollar inflow instead of raw per cent, and a model sandbox lets a reader move the constants and watch the ranking move.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /home/hatch/workspace/makefun/token-radar-01-kit/token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=q57bcks6&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
