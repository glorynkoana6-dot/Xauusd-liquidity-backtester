/* ================================================================
   TYSON TRADE AI
   EMA MULTI-TIMEFRAME STRATEGY LAB V1

   FILE
   ----
   /api/backtest.js

   DATA
   ----
   Twelve Data

   ENVIRONMENT VARIABLE
   --------------------
   TWELVE_DATA_API_KEY_4

   FALLBACK
   --------
   TWELVE_DATA_API_KEY

   SYMBOL
   ------
   XAU/USD

   TIMEFRAMES
   ----------
   M5
   M15
   H1
   H4

   EMA SET
   -------
   EMA 20
   EMA 50
   EMA 200

   PURPOSE
   -------
   - Evaluate EMA alignment across all timeframes
   - Backtest several strategy configurations
   - Rank EMA strategies
   - Prevent obvious future-data leakage
   - Enter on NEXT M5 candle
   - ATR-based stop loss
   - R:R based take profit
   - Fixed-fraction equity simulation
================================================================ */


const TD_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


const EMA_FAST = 20;
const EMA_MID = 50;
const EMA_SLOW = 200;

const ATR_LENGTH = 14;


/* ================================================================
   TIMEFRAMES
================================================================ */

const TIMEFRAMES = {

  m5: {
    label: "M5",
    interval: "5min",
    ms: 5 * 60 * 1000
  },

  m15: {
    label: "M15",
    interval: "15min",
    ms: 15 * 60 * 1000
  },

  h1: {
    label: "H1",
    interval: "1h",
    ms: 60 * 60 * 1000
  },

  h4: {
    label: "H4",
    interval: "4h",
    ms: 4 * 60 * 60 * 1000
  }

};


/* ================================================================
   SMALL HELPERS
================================================================ */

function clamp(value, min, max) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


function round(value, decimals = 2) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const p =
    10 ** decimals;

  return (
    Math.round(value * p) / p
  );

}


function first(value) {

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;

}


function numberParam(
  value,
  fallback,
  min,
  max
) {

  const n =
    Number(first(value));

  if (!Number.isFinite(n)) {
    return fallback;
  }

  return clamp(
    n,
    min,
    max
  );

}


function integerParam(
  value,
  fallback,
  min,
  max
) {

  return Math.round(
    numberParam(
      value,
      fallback,
      min,
      max
    )
  );

}


function stringParam(
  value,
  fallback
) {

  const v =
    first(value);

  if (
    v === undefined ||
    v === null ||
    v === ""
  ) {
    return fallback;
  }

  return String(v);

}


/* ================================================================
   DATE PARSER
================================================================ */

function parseTwelveDateTime(value) {

  if (!value) {
    return null;
  }

  const normalized =
    value.includes("T")
      ? value
      : value.replace(
          " ",
          "T"
        );

  const withZone =
    normalized.endsWith("Z")
      ? normalized
      : `${normalized}Z`;

  const ts =
    Date.parse(withZone);

  if (!Number.isFinite(ts)) {
    return null;
  }

  return ts;

}


/* ================================================================
   EMA
================================================================ */

function ema(values, length) {

  const output =
    new Array(values.length).fill(null);

  if (
    !Array.isArray(values) ||
    values.length < length
  ) {
    return output;
  }

  let seed = 0;

  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed += values[i];

  }

  seed /= length;

  output[length - 1] =
    seed;

  const multiplier =
    2 / (length + 1);

  for (
    let i = length;
    i < values.length;
    i++
  ) {

    output[i] =
      (
        values[i] -
        output[i - 1]
      ) *
        multiplier +
      output[i - 1];

  }

  return output;

}


/* ================================================================
   ATR
================================================================ */

function atr(
  candles,
  length = ATR_LENGTH
) {

  const tr =
    new Array(candles.length)
      .fill(null);

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    const c =
      candles[i];

    if (i === 0) {

      tr[i] =
        c.high - c.low;

      continue;

    }

    const previousClose =
      candles[i - 1].close;

    tr[i] =
      Math.max(

        c.high - c.low,

        Math.abs(
          c.high -
          previousClose
        ),

        Math.abs(
          c.low -
          previousClose
        )

      );

  }


  const output =
    new Array(candles.length)
      .fill(null);


  if (
    candles.length < length
  ) {
    return output;
  }


  let seed = 0;

  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed += tr[i];

  }

  seed /= length;

  output[length - 1] =
    seed;


  for (
    let i = length;
    i < candles.length;
    i++
  ) {

    output[i] =
      (
        output[i - 1] *
          (length - 1) +
        tr[i]
      ) /
      length;

  }

  return output;

}


/* ================================================================
   FETCH TWELVE DATA
================================================================ */

async function fetchSeries(
  timeframe,
  outputsize
) {

  const config =
    TIMEFRAMES[timeframe];

  if (!config) {

    throw new Error(
      `Unknown timeframe: ${timeframe}`
    );

  }


  const url =
    new URL(TD_BASE);


  url.searchParams.set(
    "symbol",
    SYMBOL
  );

  url.searchParams.set(
    "interval",
    config.interval
  );

  url.searchParams.set(
    "outputsize",
    String(outputsize)
  );

  url.searchParams.set(
    "apikey",
    TD_KEY
  );

  url.searchParams.set(
    "timezone",
    "UTC"
  );

  url.searchParams.set(
    "format",
    "JSON"
  );


  const response =
    await fetch(
      url.toString(),
      {
        cache: "no-store"
      }
    );


  let json;

  try {

    json =
      await response.json();

  } catch {

    throw new Error(
      `Twelve Data ${config.label} returned invalid JSON`
    );

  }


  if (!response.ok) {

    throw new Error(
      json?.message ||
      `Twelve Data ${config.label} HTTP ${response.status}`
    );

  }


  if (
    json?.status === "error"
  ) {

    throw new Error(
      json?.message ||
      `Twelve Data ${config.label} API error`
    );

  }


  if (
    !Array.isArray(json?.values)
  ) {

    throw new Error(
      `No ${config.label} candle data returned`
    );

  }


  const now =
    Date.now();


  const candles =
    json.values

      .map((row) => {

        const ts =
          parseTwelveDateTime(
            row.datetime
          );

        const open =
          Number(row.open);

        const high =
          Number(row.high);

        const low =
          Number(row.low);

        const close =
          Number(row.close);

        const volume =
          Number(row.volume || 0);

        if (
          !Number.isFinite(ts) ||
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close)
        ) {
          return null;
        }

        return {

          ts,

          closeTs:
            ts +
            config.ms,

          datetime:
            row.datetime,

          open,
          high,
          low,
          close,

          volume:
            Number.isFinite(volume)
              ? volume
              : 0

        };

      })

      .filter(Boolean)

      /*
       * IMPORTANT:
       * remove the currently-forming candle.
       */
      .filter(
        (c) =>
          c.closeTs <=
          now - 1000
      )

      .sort(
        (a, b) =>
          a.ts - b.ts
      );


  /*
   * Remove duplicate timestamps if any.
   */

  const unique =
    [];

  let lastTs =
    null;


  for (
    const candle of candles
  ) {

    if (
      candle.ts === lastTs
    ) {
      continue;
    }

    unique.push(candle);

    lastTs =
      candle.ts;

  }


  return unique;

}


/* ================================================================
   ADD EMA + ATR DATA
================================================================ */

function decorateSeries(
  candles
) {

  const closes =
    candles.map(
      (c) => c.close
    );


  const ema20 =
    ema(
      closes,
      EMA_FAST
    );


  const ema50 =
    ema(
      closes,
      EMA_MID
    );


  const ema200 =
    ema(
      closes,
      EMA_SLOW
    );


  const atr14 =
    atr(
      candles,
      ATR_LENGTH
    );


  return candles.map(
    (c, i) => {

      const currentEMA20 =
        ema20[i];

      const previousEMA20 =
        i > 0
          ? ema20[i - 1]
          : null;


      let ema20Slope = 0;


      if (
        Number.isFinite(currentEMA20) &&
        Number.isFinite(previousEMA20)
      ) {

        if (
          currentEMA20 >
          previousEMA20
        ) {

          ema20Slope = 1;

        } else if (
          currentEMA20 <
          previousEMA20
        ) {

          ema20Slope = -1;

        }

      }


      return {

        ...c,

        ema20:
          currentEMA20,

        ema50:
          ema50[i],

        ema200:
          ema200[i],

        atr14:
          atr14[i],

        ema20Slope

      };

    }
  );

}


/* ================================================================
   EMA ALIGNMENT
================================================================ */

function alignment(candle) {

  if (
    !candle ||
    !Number.isFinite(candle.ema20) ||
    !Number.isFinite(candle.ema50) ||
    !Number.isFinite(candle.ema200)
  ) {

    return 0;

  }


  if (
    candle.ema20 >
      candle.ema50 &&
    candle.ema50 >
      candle.ema200
  ) {

    return 1;

  }


  if (
    candle.ema20 <
      candle.ema50 &&
    candle.ema50 <
      candle.ema200
  ) {

    return -1;

  }


  return 0;

}


/* ================================================================
   EMA SCORE
================================================================ */

function candleScore(candle) {

  let bull = 0;
  let bear = 0;


  if (!candle) {

    return {
      bull,
      bear
    };

  }


  /*
   * EMA 20 vs EMA 50
   */

  if (
    candle.ema20 >
    candle.ema50
  ) {

    bull++;

  } else if (
    candle.ema20 <
    candle.ema50
  ) {

    bear++;

  }


  /*
   * EMA 50 vs EMA 200
   */

  if (
    candle.ema50 >
    candle.ema200
  ) {

    bull++;

  } else if (
    candle.ema50 <
    candle.ema200
  ) {

    bear++;

  }


  /*
   * Price vs EMA 20
   */

  if (
    candle.close >
    candle.ema20
  ) {

    bull++;

  } else if (
    candle.close <
    candle.ema20
  ) {

    bear++;

  }


  /*
   * EMA20 slope
   */

  if (
    candle.ema20Slope > 0
  ) {

    bull++;

  } else if (
    candle.ema20Slope < 0
  ) {

    bear++;

  }


  return {
    bull,
    bear
  };

}


/* ================================================================
   FIND LATEST COMPLETED HTF BAR
================================================================ */

function completedIndex(
  candles,
  signalCloseTs
) {

  let low = 0;

  let high =
    candles.length - 1;

  let answer = -1;


  while (
    low <= high
  ) {

    const mid =
      Math.floor(
        (low + high) / 2
      );


    if (
      candles[mid].closeTs <=
      signalCloseTs
    ) {

      answer =
        mid;

      low =
        mid + 1;

    } else {

      high =
        mid - 1;

    }

  }


  return answer;

}


/* ================================================================
   CONTEXT AT M5 CANDLE
================================================================ */

function getContext(
  data,
  m5Index
) {

  const m5 =
    data.m5[m5Index];


  if (!m5) {
    return null;
  }


  const signalCloseTs =
    m5.closeTs;


  const m15Index =
    completedIndex(
      data.m15,
      signalCloseTs
    );


  const h1Index =
    completedIndex(
      data.h1,
      signalCloseTs
    );


  const h4Index =
    completedIndex(
      data.h4,
      signalCloseTs
    );


  if (
    m15Index < 0 ||
    h1Index < 0 ||
    h4Index < 0
  ) {

    return null;

  }


  const context = {

    m5,

    m15:
      data.m15[m15Index],

    h1:
      data.h1[h1Index],

    h4:
      data.h4[h4Index]

  };


  for (
    const key of [
      "m5",
      "m15",
      "h1",
      "h4"
    ]
  ) {

    const c =
      context[key];


    if (
      !Number.isFinite(c.ema20) ||
      !Number.isFinite(c.ema50) ||
      !Number.isFinite(c.ema200)
    ) {

      return null;

    }

  }


  return context;

}


/* ================================================================
   FULL CONTEXT SCORE
================================================================ */

function scoreContext(
  context
) {

  let bull = 0;

  let bear = 0;


  const details = {};


  for (
    const key of [
      "m5",
      "m15",
      "h1",
      "h4"
    ]
  ) {

    const candle =
      context[key];


    const score =
      candleScore(candle);


    bull +=
      score.bull;

    bear +=
      score.bear;


    details[key] = {

      alignment:
        alignment(candle),

      bull:
        score.bull,

      bear:
        score.bear

    };

  }


  const maximum =
    16;


  return {

    bull,

    bear,

    bullPct:
      round(
        bull /
          maximum *
          100,
        1
      ),

    bearPct:
      round(
        bear /
          maximum *
          100,
        1
      ),

    details

  };

}


/* ================================================================
   NUMBER OF ALIGNED TIMEFRAMES
================================================================ */

function alignmentCount(
  context,
  side
) {

  let count = 0;


  for (
    const key of [
      "m5",
      "m15",
      "h1",
      "h4"
    ]
  ) {

    if (
      alignment(
        context[key]
      ) === side
    ) {

      count++;

    }

  }


  return count;

}


/* ================================================================
   TREND QUALIFICATION
================================================================ */

function trendQualifies(
  context,
  side,
  preset
) {

  const count =
    alignmentCount(
      context,
      side
    );


  if (
    count <
    preset.requiredAligned
  ) {

    return false;

  }


  if (
    preset.requireH4 &&
    alignment(
      context.h4
    ) !== side
  ) {

    return false;

  }


  if (
    preset.requireH1 &&
    alignment(
      context.h1
    ) !== side
  ) {

    return false;

  }


  if (
    preset.requireM15 &&
    alignment(
      context.m15
    ) !== side
  ) {

    return false;

  }


  const score =
    scoreContext(context);


  const sideScore =
    side === 1
      ? score.bullPct
      : score.bearPct;


  if (
    sideScore <
    preset.minScore
  ) {

    return false;

  }


  return true;

}


/* ================================================================
   ENTRY TRIGGERS
================================================================ */

function triggerPasses(
  data,
  index,
  side,
  trigger
) {

  if (
    index <= 0
  ) {
    return false;
  }


  const current =
    data.m5[index];


  const previous =
    data.m5[index - 1];


  if (
    !Number.isFinite(
      current.ema20
    ) ||
    !Number.isFinite(
      current.atr14
    ) ||
    !Number.isFinite(
      previous.ema20
    )
  ) {

    return false;

  }


  /*
   * PULLBACK
   *
   * Price touches / approaches EMA20
   * then closes back in trend direction.
   */

  if (
    trigger === "pullback"
  ) {

    const tolerance =
      current.atr14 *
      0.15;


    if (
      side === 1
    ) {

      return (

        current.low <=
          current.ema20 +
          tolerance

        &&

        current.close >
          current.ema20

      );

    }


    return (

      current.high >=
        current.ema20 -
        tolerance

      &&

      current.close <
        current.ema20

    );

  }


  /*
   * FRESH M5 EMA STACK
   */

  if (
    trigger === "fresh"
  ) {

    return (

      alignment(current) ===
        side

      &&

      alignment(previous) !==
        side

    );

  }


  /*
   * CONTINUATION BREAKOUT
   */

  if (
    trigger ===
    "continuation"
  ) {

    if (
      side === 1
    ) {

      return (

        current.close >
          previous.high

        &&

        current.close >
          current.ema20

      );

    }


    return (

      current.close <
        previous.low

      &&

      current.close <
        current.ema20

    );

  }


  /*
   * EVERY QUALIFIED M5 BAR
   *
   * Mainly for testing the raw trend model.
   */

  if (
    trigger === "every"
  ) {

    if (
      side === 1
    ) {

      return (
        current.close >
        current.ema20
      );

    }


    return (
      current.close <
      current.ema20
    );

  }


  return false;

}


/* ================================================================
   SIMULATE SINGLE TRADE
================================================================ */

function simulateTrade({

  candles,

  signalIndex,

  entryIndex,

  side,

  preset,

  costR

}) {

  const signal =
    candles[signalIndex];


  const entryBar =
    candles[entryIndex];


  if (
    !signal ||
    !entryBar ||
    !Number.isFinite(
      signal.atr14
    )
  ) {

    return null;

  }


  let stopDistance =
    signal.atr14 *
    preset.slATR;


  /*
   * Small safety minimum.
   */

  const minimumStop =
    entryBar.open *
    0.00025;


  stopDistance =
    Math.max(
      stopDistance,
      minimumStop
    );


  const entry =
    entryBar.open;


  let stopLoss;

  let takeProfit;


  if (
    side === 1
  ) {

    stopLoss =
      entry -
      stopDistance;

    takeProfit =
      entry +
      stopDistance *
        preset.rr;

  } else {

    stopLoss =
      entry +
      stopDistance;

    takeProfit =
      entry -
      stopDistance *
        preset.rr;

  }


  const lastIndex =
    Math.min(
      candles.length - 1,
      entryIndex +
        preset.maxHold
    );


  let exitIndex =
    lastIndex;

  let exitPrice =
    candles[lastIndex].close;

  let reason =
    "TIME";

  let rawR;


  for (
    let i = entryIndex;
    i <= lastIndex;
    i++
  ) {

    const bar =
      candles[i];


    if (
      side === 1
    ) {

      const hitSL =
        bar.low <=
        stopLoss;

      const hitTP =
        bar.high >=
        takeProfit;


      /*
       * Conservative same-bar rule:
       * stop loss is assumed first.
       */

      if (
        hitSL &&
        hitTP
      ) {

        exitIndex = i;

        exitPrice =
          stopLoss;

        reason =
          "SL";

        rawR = -1;

        break;

      }


      if (hitSL) {

        exitIndex = i;

        exitPrice =
          stopLoss;

        reason =
          "SL";

        rawR = -1;

        break;

      }


      if (hitTP) {

        exitIndex = i;

        exitPrice =
          takeProfit;

        reason =
          "TP";

        rawR =
          preset.rr;

        break;

      }

    } else {

      const hitSL =
        bar.high >=
        stopLoss;

      const hitTP =
        bar.low <=
        takeProfit;


      if (
        hitSL &&
        hitTP
      ) {

        exitIndex = i;

        exitPrice =
          stopLoss;

        reason =
          "SL";

        rawR = -1;

        break;

      }


      if (hitSL) {

        exitIndex = i;

        exitPrice =
          stopLoss;

        reason =
          "SL";

        rawR = -1;

        break;

      }


      if (hitTP) {

        exitIndex = i;

        exitPrice =
          takeProfit;

        reason =
          "TP";

        rawR =
          preset.rr;

        break;

      }

    }

  }


  /*
   * Timed exit.
   */

  if (
    rawR === undefined
  ) {

    if (
      side === 1
    ) {

      rawR =
        (
          exitPrice -
          entry
        ) /
        stopDistance;

    } else {

      rawR =
        (
          entry -
          exitPrice
        ) /
        stopDistance;

    }

  }


  const netR =
    rawR -
    costR;


  return {

    side:
      side === 1
        ? "BUY"
        : "SELL",

    signalIndex,

    entryIndex,

    exitIndex,

    signalTime:
      new Date(
        signal.closeTs
      ).toISOString(),

    entryTime:
      new Date(
        entryBar.ts
      ).toISOString(),

    exitTime:
      new Date(
        candles[
          exitIndex
        ].closeTs
      ).toISOString(),

    entry:
      round(
        entry,
        5
      ),

    stopLoss:
      round(
        stopLoss,
        5
      ),

    takeProfit:
      round(
        takeProfit,
        5
      ),

    exitPrice:
      round(
        exitPrice,
        5
      ),

    stopDistance:
      round(
        stopDistance,
        5
      ),

    rawR:
      round(
        rawR,
        4
      ),

    netR:
      round(
        netR,
        4
      ),

    reason,

    holdBars:
      exitIndex -
      entryIndex +
      1

  };

}


/* ================================================================
   STRATEGY EVALUATION
================================================================ */

function evaluateMetrics({

  trades,

  initialBalance,

  riskPct

}) {

  const totalTrades =
    trades.length;


  let wins = 0;

  let losses = 0;

  let breakeven = 0;

  let longTrades = 0;

  let shortTrades = 0;

  let grossProfitR = 0;

  let grossLossR = 0;

  let totalR = 0;

  let holdBarsTotal = 0;


  let equity =
    initialBalance;


  let peakEquity =
    equity;


  let maxDrawdownPct = 0;


  const equityCurve = [
    {
      trade: 0,
      equity:
        round(
          equity,
          2
        )
    }
  ];


  let consecutiveWins = 0;

  let consecutiveLosses = 0;

  let maxWinStreak = 0;

  let maxLossStreak = 0;


  for (
    let i = 0;
    i < trades.length;
    i++
  ) {

    const trade =
      trades[i];


    const r =
      trade.netR;


    totalR += r;

    holdBarsTotal +=
      trade.holdBars;


    if (
      trade.side === "BUY"
    ) {

      longTrades++;

    } else {

      shortTrades++;

    }


    if (
      r > 0
    ) {

      wins++;

      grossProfitR += r;

      consecutiveWins++;

      consecutiveLosses = 0;

      maxWinStreak =
        Math.max(
          maxWinStreak,
          consecutiveWins
        );

    } else if (
      r < 0
    ) {

      losses++;

      grossLossR +=
        Math.abs(r);

      consecutiveLosses++;

      consecutiveWins = 0;

      maxLossStreak =
        Math.max(
          maxLossStreak,
          consecutiveLosses
        );

    } else {

      breakeven++;

      consecutiveWins = 0;

      consecutiveLosses = 0;

    }


    /*
     * Fixed-fraction risk model.
     *
     * 1R = riskPct of current equity.
     */

    const changePct =
      (
        r *
        riskPct
      ) /
      100;


    equity *=
      1 +
      changePct;


    if (
      equity >
      peakEquity
    ) {

      peakEquity =
        equity;

    }


    const drawdownPct =
      peakEquity > 0
        ? (
            (
              peakEquity -
              equity
            ) /
            peakEquity
          ) *
          100
        : 0;


    maxDrawdownPct =
      Math.max(
        maxDrawdownPct,
        drawdownPct
      );


    equityCurve.push({

      trade:
        i + 1,

      equity:
        round(
          equity,
          2
        )

    });

  }


  const winRate =
    totalTrades > 0
      ? (
          wins /
          totalTrades
        ) *
        100
      : 0;


  let profitFactor = 0;


  if (
    grossLossR > 0
  ) {

    profitFactor =
      grossProfitR /
      grossLossR;

  } else if (
    grossProfitR > 0
  ) {

    profitFactor =
      99;

  }


  const expectancyR =
    totalTrades > 0
      ? totalR /
        totalTrades
      : 0;


  const averageWinR =
    wins > 0
      ? grossProfitR /
        wins
      : 0;


  const averageLossR =
    losses > 0
      ? grossLossR /
        losses
      : 0;


  const averageHoldBars =
    totalTrades > 0
      ? holdBarsTotal /
        totalTrades
      : 0;


  const returnPct =
    initialBalance > 0
      ? (
          (
            equity -
            initialBalance
          ) /
          initialBalance
        ) *
        100
      : 0;


  let grade =
    "D";


  let verdict =
    "Weak historical edge";


  if (
    totalTrades < 15
  ) {

    grade =
      "N/A";

    verdict =
      "Not enough trades to evaluate reliably";

  } else if (
    totalTrades >= 30 &&
    profitFactor >= 1.5 &&
    expectancyR >= 0.25 &&
    maxDrawdownPct <= 10
  ) {

    grade =
      "A";

    verdict =
      "Strong historical test";

  } else if (
    totalTrades >= 25 &&
    profitFactor >= 1.25 &&
    expectancyR >= 0.12 &&
    maxDrawdownPct <= 15
  ) {

    grade =
      "B";

    verdict =
      "Promising historical edge";

  } else if (
    profitFactor >= 1.05 &&
    expectancyR > 0
  ) {

    grade =
      "C";

    verdict =
      "Positive but needs improvement";

  }


  /*
   * Ranking score.
   *
   * This is NOT win probability.
   */

  let rankingScore =
    (
      expectancyR *
        32
    ) +
    (
      Math.min(
        profitFactor,
        4
      ) *
        12
    ) +
    (
      Math.min(
        totalTrades,
        100
      ) *
        0.08
    ) -
    (
      maxDrawdownPct *
        1.2
    );


  if (
    totalTrades < 10
  ) {

    rankingScore -=
      25;

  }


  return {

    trades:
      totalTrades,

    wins,

    losses,

    breakeven,

    longTrades,

    shortTrades,

    winRate:
      round(
        winRate,
        2
      ),

    profitFactor:
      round(
        profitFactor,
        2
      ),

    expectancyR:
      round(
        expectancyR,
        4
      ),

    totalR:
      round(
        totalR,
        2
      ),

    averageWinR:
      round(
        averageWinR,
        3
      ),

    averageLossR:
      round(
        averageLossR,
        3
      ),

    averageHoldBars:
      round(
        averageHoldBars,
        1
      ),

    maxWinStreak,

    maxLossStreak,

    initialBalance:
      round(
        initialBalance,
        2
      ),

    finalBalance:
      round(
        equity,
        2
      ),

    returnPct:
      round(
        returnPct,
        2
      ),

    maxDrawdownPct:
      round(
        maxDrawdownPct,
        2
      ),

    rankingScore:
      round(
        rankingScore,
        2
      ),

    grade,

    verdict,

    equityCurve

  };

}


/* ================================================================
   RUN BACKTEST
================================================================ */

function runBacktest({

  data,

  startIndex,

  preset,

  initialBalance,

  riskPct,

  costR,

  sideFilter = "both",

  includeDetails = false

}) {

  const trades = [];


  const lastSignalIndex =
    data.m5.length - 2;


  let i =
    Math.max(
      startIndex,
      210
    );


  while (
    i <=
    lastSignalIndex
  ) {

    const context =
      getContext(
        data,
        i
      );


    if (!context) {

      i++;

      continue;

    }


    let longQualified =
      false;


    let shortQualified =
      false;


    if (
      sideFilter === "both" ||
      sideFilter === "long"
    ) {

      longQualified =
        trendQualifies(
          context,
          1,
          preset
        ) &&
        triggerPasses(
          data,
          i,
          1,
          preset.trigger
        );

    }


    if (
      sideFilter === "both" ||
      sideFilter === "short"
    ) {

      shortQualified =
        trendQualifies(
          context,
          -1,
          preset
        ) &&
        triggerPasses(
          data,
          i,
          -1,
          preset.trigger
        );

    }


    if (
      !longQualified &&
      !shortQualified
    ) {

      i++;

      continue;

    }


    const scores =
      scoreContext(
        context
      );


    let side;


    if (
      longQualified &&
      shortQualified
    ) {

      side =
        scores.bullPct >=
        scores.bearPct
          ? 1
          : -1;

    } else {

      side =
        longQualified
          ? 1
          : -1;

    }


    const trade =
      simulateTrade({

        candles:
          data.m5,

        signalIndex:
          i,

        entryIndex:
          i + 1,

        side,

        preset,

        costR

      });


    if (!trade) {

      i++;

      continue;

    }


    trade.emaScore =
      side === 1
        ? scores.bullPct
        : scores.bearPct;


    trade.alignedTF =
      alignmentCount(
        context,
        side
      );


    trades.push(trade);


    /*
     * One trade at a time.
     */

    i =
      trade.exitIndex +
      preset.cooldownBars +
      1;

  }


  const metrics =
    evaluateMetrics({

      trades,

      initialBalance,

      riskPct

    });


  const result = {

    id:
      preset.id,

    name:
      preset.name,

    settings: {

      trigger:
        preset.trigger,

      requiredAligned:
        preset.requiredAligned,

      minScore:
        preset.minScore,

      requireH4:
        preset.requireH4,

      requireH1:
        preset.requireH1,

      requireM15:
        preset.requireM15,

      slATR:
        preset.slATR,

      rr:
        preset.rr,

      maxHold:
        preset.maxHold,

      cooldownBars:
        preset.cooldownBars,

      sideFilter

    },

    metrics: {

      ...metrics,

      equityCurve:
        includeDetails
          ? metrics.equityCurve
          : undefined

    }

  };


  if (
    includeDetails
  ) {

    result.trades =
      trades
        .slice(-200)
        .reverse();

  }


  return result;

}


/* ================================================================
   LATEST MARKET ASSESSMENT
================================================================ */

function latestAssessment(
  data
) {

  /*
   * Latest M5 candle that has another candle after it
   * so its context is definitely completed.
   */

  const index =
    Math.max(
      0,
      data.m5.length - 2
    );


  const context =
    getContext(
      data,
      index
    );


  if (!context) {
    return null;
  }


  const score =
    scoreContext(
      context
    );


  let bias =
    "NEUTRAL";


  if (
    score.bullPct >= 70 &&
    score.bullPct >
      score.bearPct
  ) {

    bias =
      "BULLISH";

  }


  if (
    score.bearPct >= 70 &&
    score.bearPct >
      score.bullPct
  ) {

    bias =
      "BEARISH";

  }


  const tf = {};


  for (
    const key of [
      "m5",
      "m15",
      "h1",
      "h4"
    ]
  ) {

    const c =
      context[key];


    const a =
      alignment(c);


    tf[key] = {

      label:
        TIMEFRAMES[key].label,

      close:
        round(
          c.close,
          5
        ),

      ema20:
        round(
          c.ema20,
          5
        ),

      ema50:
        round(
          c.ema50,
          5
        ),

      ema200:
        round(
          c.ema200,
          5
        ),

      alignment:
        a === 1
          ? "BULLISH"
          : a === -1
            ? "BEARISH"
            : "MIXED"

    };

  }


  return {

    time:
      new Date(
        context.m5.closeTs
      ).toISOString(),

    price:
      round(
        context.m5.close,
        5
      ),

    bias,

    bullScore:
      score.bullPct,

    bearScore:
      score.bearPct,

    timeframes:
      tf

  };

}


/* ================================================================
   PRESET STRATEGIES
================================================================ */

function defaultPresets() {

  return [

    {
      id:
        "strict-pullback-2r",

      name:
        "STRICT • Pullback • 2R",

      trigger:
        "pullback",

      requiredAligned:
        4,

      minScore:
        72,

      requireH4:
        true,

      requireH1:
        true,

      requireM15:
        true,

      slATR:
        1.25,

      rr:
        2.0,

      maxHold:
        60,

      cooldownBars:
        3
    },


    {
      id:
        "strict-continuation-2r",

      name:
        "STRICT • Continuation • 2R",

      trigger:
        "continuation",

      requiredAligned:
        4,

      minScore:
        72,

      requireH4:
        true,

      requireH1:
        true,

      requireM15:
        true,

      slATR:
        1.25,

      rr:
        2.0,

      maxHold:
        60,

      cooldownBars:
        3
    },


    {
      id:
        "balanced-pullback-2r",

      name:
        "BALANCED • Pullback • 2R",

      trigger:
        "pullback",

      requiredAligned:
        3,

      minScore:
        62,

      requireH4:
        true,

      requireH1:
        true,

      requireM15:
        false,

      slATR:
        1.2,

      rr:
        2.0,

      maxHold:
        60,

      cooldownBars:
        3
    },


    {
      id:
        "balanced-pullback-15r",

      name:
        "BALANCED • Pullback • 1.5R",

      trigger:
        "pullback",

      requiredAligned:
        3,

      minScore:
        62,

      requireH4:
        true,

      requireH1:
        true,

      requireM15:
        false,

      slATR:
        1.15,

      rr:
        1.5,

      maxHold:
        48,

      cooldownBars:
        3
    },


    {
      id:
        "balanced-fresh-2r",

      name:
        "BALANCED • Fresh Stack • 2R",

      trigger:
        "fresh",

      requiredAligned:
        3,

      minScore:
        60,

      requireH4:
        true,

      requireH1:
        true,

      requireM15:
        false,

      slATR:
        1.2,

      rr:
        2.0,

      maxHold:
        60,

      cooldownBars:
        4
    },


    {
      id:
        "aggressive-continuation-15r",

      name:
        "AGGRESSIVE • Continuation • 1.5R",

      trigger:
        "continuation",

      requiredAligned:
        2,

      minScore:
        56,

      requireH4:
        false,

      requireH1:
        true,

      requireM15:
        false,

      slATR:
        1.1,

      rr:
        1.5,

      maxHold:
        40,

      cooldownBars:
        2
    }

  ];

}


/* ================================================================
   DATA CACHE
================================================================ */

let CACHE = {

  key: null,

  expires: 0,

  data: null

};


/* ================================================================
   GET DATA
================================================================ */

async function getData(
  requestedBars
) {

  /*
   * Extra M5 candles for EMA warm-up.
   */

  const m5Size =
    Math.min(
      5000,
      requestedBars +
        260
    );


  const m15Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 3
      ) +
        260
    );


  const h1Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 12
      ) +
        260
    );


  const h4Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 48
      ) +
        260
    );


  const cacheKey =
    [
      m5Size,
      m15Size,
      h1Size,
      h4Size
    ].join("-");


  if (
    CACHE.key ===
      cacheKey &&
    CACHE.data &&
    CACHE.expires >
      Date.now()
  ) {

    return CACHE.data;

  }


  const [
    rawM5,
    rawM15,
    rawH1,
    rawH4
  ] =
    await Promise.all([

      fetchSeries(
        "m5",
        m5Size
      ),

      fetchSeries(
        "m15",
        m15Size
      ),

      fetchSeries(
        "h1",
        h1Size
      ),

      fetchSeries(
        "h4",
        h4Size
      )

    ]);


  const data = {

    m5:
      decorateSeries(
        rawM5
      ),

    m15:
      decorateSeries(
        rawM15
      ),

    h1:
      decorateSeries(
        rawH1
      ),

    h4:
      decorateSeries(
        rawH4
      )

  };


  CACHE = {

    key:
      cacheKey,

    expires:
      Date.now() +
      45 * 1000,

    data

  };


  return data;

}


/* ================================================================
   API HANDLER
================================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );


  if (
    req.method !== "GET"
  ) {

    return res
      .status(405)
      .json({

        ok: false,

        error:
          "GET requests only"

      });

  }


  if (!TD_KEY) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing TWELVE_DATA_API_KEY_4 or TWELVE_DATA_API_KEY in Vercel environment variables."

      });

  }


  try {

    const q =
      req.query || {};


    const bars =
      integerParam(
        q.bars,
        2200,
        600,
        4500
      );


    const rr =
      numberParam(
        q.rr,
        2,
        0.5,
        6
      );


    const slATR =
      numberParam(
        q.slATR,
        1.2,
        0.3,
        5
      );


    const requiredAligned =
      integerParam(
        q.requiredAligned,
        3,
        1,
        4
      );


    const minScore =
      numberParam(
        q.minScore,
        62,
        25,
        100
      );


    const maxHold =
      integerParam(
        q.maxHold,
        60,
        3,
        400
      );


    const cooldownBars =
      integerParam(
        q.cooldownBars,
        3,
        0,
        100
      );


    const costR =
      numberParam(
        q.costR,
        0.03,
        0,
        0.5
      );


    const initialBalance =
      numberParam(
        q.initialBalance,
        10000,
        100,
        100000000
      );


    const riskPct =
      numberParam(
        q.riskPct,
        0.5,
        0.01,
        10
      );


    const triggerRaw =
      stringParam(
        q.trigger,
        "pullback"
      );


    const allowedTriggers =
      [
        "pullback",
        "fresh",
        "continuation",
        "every"
      ];


    const trigger =
      allowedTriggers.includes(
        triggerRaw
      )
        ? triggerRaw
        : "pullback";


    const sideRaw =
      stringParam(
        q.side,
        "both"
      );


    const sideFilter =
      [
        "both",
        "long",
        "short"
      ].includes(sideRaw)
        ? sideRaw
        : "both";


    const requireH4 =
      stringParam(
        q.requireH4,
        "true"
      ) !== "false";


    const requireH1 =
      stringParam(
        q.requireH1,
        "true"
      ) !== "false";


    const requireM15 =
      stringParam(
        q.requireM15,
        "false"
      ) === "true";


    /*
     * Load data.
     */

    const data =
      await getData(
        bars
      );


    if (
      data.m5.length < 300 ||
      data.m15.length < 220 ||
      data.h1.length < 220 ||
      data.h4.length < 220
    ) {

      throw new Error(
        "Not enough candle history returned to calculate EMA200 across all timeframes."
      );

    }


    /*
     * Start only after EMA warmup.
     */

    const startIndex =
      Math.max(
        210,
        data.m5.length -
          bars
      );


    const customPreset = {

      id:
        "custom",

      name:
        "CUSTOM EMA MTF",

      trigger,

      requiredAligned,

      minScore,

      requireH4,

      requireH1,

      requireM15,

      slATR,

      rr,

      maxHold,

      cooldownBars

    };


    /*
     * CUSTOM STRATEGY
     */

    const custom =
      runBacktest({

        data,

        startIndex,

        preset:
          customPreset,

        initialBalance,

        riskPct,

        costR,

        sideFilter,

        includeDetails:
          true

      });


    /*
     * STRATEGY LAB
     */

    const lab = [];


    for (
      const preset of
      defaultPresets()
    ) {

      lab.push(

        runBacktest({

          data,

          startIndex,

          preset,

          initialBalance,

          riskPct,

          costR,

          sideFilter:
            "both",

          includeDetails:
            false

        })

      );

    }


    lab.sort(
      (a, b) =>
        (
          b.metrics
            .rankingScore ||
          -999
        ) -
        (
          a.metrics
            .rankingScore ||
          -999
        )
    );


    /*
     * Latest state.
     */

    const latest =
      latestAssessment(
        data
      );


    const firstBacktestBar =
      data.m5[
        startIndex
      ];


    const lastBacktestBar =
      data.m5[
        data.m5.length - 1
      ];


    return res
      .status(200)
      .json({

        ok: true,

        meta: {

          engine:
            "TYSON EMA MTF STRATEGY LAB V1",

          provider:
            "Twelve Data",

          symbol:
            SYMBOL,

          executionTimeframe:
            "M5",

          timeframes: [
            "M5",
            "M15",
            "H1",
            "H4"
          ],

          ema: [
            20,
            50,
            200
          ],

          requestedBars:
            bars,

          availableM5Bars:
            data.m5.length,

          backtestStart:
            firstBacktestBar
              ? new Date(
                  firstBacktestBar.ts
                ).toISOString()
              : null,

          backtestEnd:
            lastBacktestBar
              ? new Date(
                  lastBacktestBar.closeTs
                ).toISOString()
              : null,

          assumptions: [

            "Signals use completed candles only.",

            "Higher-timeframe candles must be completed before they can affect an M5 signal.",

            "Entry occurs at the next M5 candle open.",

            "If TP and SL are both touched inside the same M5 candle, SL is assumed to occur first.",

            "Equity simulation uses fixed fractional risk.",

            "Trading cost is approximated using cost in R."

          ]

        },

        latest,

        custom,

        lab

      });


  } catch (
    error
  ) {

    console.error(
      "EMA BACKTEST ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          error?.message ||
          "Backtest failed"

      });

  }

}