/* ================================================================
   TYSON TRADE AI
   TREND PULLBACK V1
   ---------------------------------------------------------------
   FILE:
   /api/backtest.js

   MARKET:
   XAU/USD

   PROVIDER:
   Twelve Data

   ENV:
   TWELVE_DATA_API_KEY_4
   fallback: TWELVE_DATA_API_KEY

   STRATEGY
   --------
   H4  = macro EMA regime
   H1  = trend alignment
   M15 = trend + ADX strength
   M5  = pullback + continuation entry

   INDICATORS
   ----------
   EMA20 / EMA50 / EMA200
   ATR14
   RSI14
   ADX14

   ENTRY
   -----
   Completed M5 signal candle.
   Entry = NEXT M5 open.

   EXIT
   ----
   Structural + ATR stop
   R multiple target
   Optional breakeven after +1R

   IMPORTANT
   ---------
   Historical performance does not guarantee future profitability.
================================================================ */


const TD_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


/* ================================================================
   TIMEFRAMES
================================================================ */

const TF = {

  m5: {
    interval: "5min",
    ms: 5 * 60 * 1000
  },

  m15: {
    interval: "15min",
    ms: 15 * 60 * 1000
  },

  h1: {
    interval: "1h",
    ms: 60 * 60 * 1000
  },

  h4: {
    interval: "4h",
    ms: 4 * 60 * 60 * 1000
  }

};


/* ================================================================
   HELPERS
================================================================ */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


function round(
  value,
  decimals = 2
) {

  if (
    !Number.isFinite(value)
  ) {
    return null;
  }

  const p =
    10 ** decimals;

  return (
    Math.round(
      value * p
    ) / p
  );

}


function first(value) {

  return Array.isArray(value)
    ? value[0]
    : value;

}


function numberParam(
  value,
  fallback,
  min,
  max
) {

  const n =
    Number(
      first(value)
    );

  if (
    !Number.isFinite(n)
  ) {
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


function boolParam(
  value,
  fallback
) {

  const v =
    first(value);

  if (
    v === undefined ||
    v === null
  ) {
    return fallback;
  }

  return String(v) === "true";

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

function parseDate(value) {

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

  const ts =
    Date.parse(
      normalized.endsWith("Z")
        ? normalized
        : `${normalized}Z`
    );

  return Number.isFinite(ts)
    ? ts
    : null;

}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  length
) {

  const out =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length
  ) {
    return out;
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


  out[
    length - 1
  ] = seed;


  const k =
    2 /
    (
      length + 1
    );


  for (
    let i = length;
    i < values.length;
    i++
  ) {

    out[i] =
      (
        values[i] -
        out[i - 1]
      ) *
        k +
      out[i - 1];

  }


  return out;

}


/* ================================================================
   ATR
================================================================ */

function atr(
  candles,
  length = 14
) {

  const tr =
    new Array(
      candles.length
    ).fill(null);


  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    if (
      i === 0
    ) {

      tr[i] =
        candles[i].high -
        candles[i].low;

      continue;

    }


    const c =
      candles[i];

    const pc =
      candles[
        i - 1
      ].close;


    tr[i] =
      Math.max(

        c.high -
        c.low,

        Math.abs(
          c.high -
          pc
        ),

        Math.abs(
          c.low -
          pc
        )

      );

  }


  const out =
    new Array(
      candles.length
    ).fill(null);


  if (
    candles.length <
    length
  ) {
    return out;
  }


  let sum = 0;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    sum += tr[i];

  }


  out[
    length - 1
  ] =
    sum / length;


  for (
    let i = length;
    i < candles.length;
    i++
  ) {

    out[i] =
      (
        out[i - 1] *
          (
            length - 1
          ) +
        tr[i]
      ) /
      length;

  }


  return out;

}


/* ================================================================
   RSI
================================================================ */

function rsi(
  values,
  length = 14
) {

  const out =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length + 1
  ) {
    return out;
  }


  let gains = 0;
  let losses = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    if (
      change >= 0
    ) {

      gains += change;

    } else {

      losses +=
        Math.abs(change);

    }

  }


  let avgGain =
    gains / length;


  let avgLoss =
    losses / length;


  out[length] =
    avgLoss === 0
      ? 100
      : 100 -
        (
          100 /
          (
            1 +
            avgGain /
            avgLoss
          )
        );


  for (
    let i =
      length + 1;
    i <
      values.length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    const gain =
      change > 0
        ? change
        : 0;


    const loss =
      change < 0
        ? Math.abs(change)
        : 0;


    avgGain =
      (
        avgGain *
          (
            length - 1
          ) +
        gain
      ) /
      length;


    avgLoss =
      (
        avgLoss *
          (
            length - 1
          ) +
        loss
      ) /
      length;


    out[i] =
      avgLoss === 0
        ? 100
        : 100 -
          (
            100 /
            (
              1 +
              avgGain /
              avgLoss
            )
          );

  }


  return out;

}


/* ================================================================
   ADX
================================================================ */

function adx(
  candles,
  length = 14
) {

  const size =
    candles.length;


  const out =
    new Array(
      size
    ).fill(null);


  const tr =
    new Array(
      size
    ).fill(0);


  const plusDM =
    new Array(
      size
    ).fill(0);


  const minusDM =
    new Array(
      size
    ).fill(0);


  for (
    let i = 1;
    i < size;
    i++
  ) {

    const current =
      candles[i];

    const previous =
      candles[
        i - 1
      ];


    const upMove =
      current.high -
      previous.high;


    const downMove =
      previous.low -
      current.low;


    plusDM[i] =
      (
        upMove >
          downMove &&
        upMove > 0
      )
        ? upMove
        : 0;


    minusDM[i] =
      (
        downMove >
          upMove &&
        downMove > 0
      )
        ? downMove
        : 0;


    tr[i] =
      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )

      );

  }


  if (
    size <
    length * 2 + 2
  ) {
    return out;
  }


  let smoothTR = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    smoothTR += tr[i];

    smoothPlus +=
      plusDM[i];

    smoothMinus +=
      minusDM[i];

  }


  const dx =
    new Array(
      size
    ).fill(null);


  for (
    let i = length;
    i < size;
    i++
  ) {

    if (
      i > length
    ) {

      smoothTR =
        smoothTR -
        smoothTR /
          length +
        tr[i];


      smoothPlus =
        smoothPlus -
        smoothPlus /
          length +
        plusDM[i];


      smoothMinus =
        smoothMinus -
        smoothMinus /
          length +
        minusDM[i];

    }


    if (
      smoothTR <= 0
    ) {
      continue;
    }


    const plusDI =
      100 *
      smoothPlus /
      smoothTR;


    const minusDI =
      100 *
      smoothMinus /
      smoothTR;


    const denominator =
      plusDI +
      minusDI;


    dx[i] =
      denominator === 0
        ? 0
        : 100 *
          Math.abs(
            plusDI -
            minusDI
          ) /
          denominator;

  }


  let dxSum = 0;
  let dxCount = 0;


  for (
    let i = length;
    i < size;
    i++
  ) {

    if (
      dx[i] === null
    ) {
      continue;
    }


    if (
      dxCount <
      length
    ) {

      dxSum += dx[i];

      dxCount++;


      if (
        dxCount ===
        length
      ) {

        out[i] =
          dxSum /
          length;

      }

      continue;

    }


    out[i] =
      (
        out[
          i - 1
        ] *
          (
            length - 1
          ) +
        dx[i]
      ) /
      length;

  }


  return out;

}


/* ================================================================
   FETCH TWELVE DATA
================================================================ */

async function fetchSeries(
  timeframe,
  outputsize
) {

  const config =
    TF[timeframe];


  const url =
    new URL(
      TD_BASE
    );


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
        cache:
          "no-store"
      }
    );


  const json =
    await response.json();


  if (
    !response.ok ||
    json?.status === "error"
  ) {

    throw new Error(
      json?.message ||
      `${timeframe} data request failed`
    );

  }


  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      `No ${timeframe} candles returned`
    );

  }


  const now =
    Date.now();


  const candles =
    json.values

      .map(
        row => {

          const ts =
            parseDate(
              row.datetime
            );


          const open =
            Number(
              row.open
            );


          const high =
            Number(
              row.high
            );


          const low =
            Number(
              row.low
            );


          const close =
            Number(
              row.close
            );


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

            open,
            high,
            low,
            close

          };

        }
      )

      .filter(Boolean)

      /* remove live incomplete candle */
      .filter(
        candle =>
          candle.closeTs <=
          now - 1000
      )

      .sort(
        (
          a,
          b
        ) =>
          a.ts -
          b.ts
      );


  const unique = [];

  let lastTs =
    null;


  for (
    const candle of
    candles
  ) {

    if (
      candle.ts ===
      lastTs
    ) {
      continue;
    }


    unique.push(
      candle
    );


    lastTs =
      candle.ts;

  }


  return unique;

}


/* ================================================================
   DECORATE CANDLES
================================================================ */

function decorate(
  candles
) {

  const closes =
    candles.map(
      c => c.close
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const e200 =
    ema(
      closes,
      200
    );


  const a14 =
    atr(
      candles,
      14
    );


  const r14 =
    rsi(
      closes,
      14
    );


  const adx14 =
    adx(
      candles,
      14
    );


  return candles.map(
    (
      candle,
      i
    ) => {

      const slope20 =
        i > 0 &&
        Number.isFinite(
          e20[i]
        ) &&
        Number.isFinite(
          e20[
            i - 1
          ]
        )
          ? e20[i] -
            e20[
              i - 1
            ]
          : null;


      const slope50 =
        i > 0 &&
        Number.isFinite(
          e50[i]
        ) &&
        Number.isFinite(
          e50[
            i - 1
          ]
        )
          ? e50[i] -
            e50[
              i - 1
            ]
          : null;


      return {

        ...candle,

        ema20:
          e20[i],

        ema50:
          e50[i],

        ema200:
          e200[i],

        atr14:
          a14[i],

        rsi14:
          r14[i],

        adx14:
          adx14[i],

        slope20,

        slope50

      };

    }
  );

}


/* ================================================================
   COMPLETED HIGHER-TIMEFRAME INDEX
================================================================ */

function completedIndex(
  candles,
  timestamp
) {

  let low = 0;

  let high =
    candles.length - 1;

  let answer = -1;


  while (
    low <= high
  ) {

    const middle =
      Math.floor(
        (
          low +
          high
        ) /
        2
      );


    if (
      candles[
        middle
      ].closeTs <=
      timestamp
    ) {

      answer =
        middle;

      low =
        middle + 1;

    } else {

      high =
        middle - 1;

    }

  }


  return answer;

}


/* ================================================================
   CONTEXT
================================================================ */

function getContext(
  data,
  m5Index
) {

  const m5 =
    data.m5[
      m5Index
    ];


  if (!m5) {
    return null;
  }


  const signalTime =
    m5.closeTs;


  const i15 =
    completedIndex(
      data.m15,
      signalTime
    );


  const i1 =
    completedIndex(
      data.h1,
      signalTime
    );


  const i4 =
    completedIndex(
      data.h4,
      signalTime
    );


  if (
    i15 < 0 ||
    i1 < 0 ||
    i4 < 0
  ) {
    return null;
  }


  return {

    m5,

    m15:
      data.m15[i15],

    h1:
      data.h1[i1],

    h4:
      data.h4[i4]

  };

}


/* ================================================================
   TREND HELPERS
================================================================ */

function fullBull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.ema50 >
      c.ema200
  );

}


function fullBear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.ema50 <
      c.ema200
  );

}


function macroBull(c) {

  return (
    c &&
    c.ema50 >
      c.ema200 &&
    c.close >
      c.ema50
  );

}


function macroBear(c) {

  return (
    c &&
    c.ema50 <
      c.ema200 &&
    c.close <
      c.ema50
  );

}


/* ================================================================
   BODY STRENGTH
================================================================ */

function bodyStrength(
  candle
) {

  const range =
    candle.high -
    candle.low;


  if (
    range <= 0
  ) {
    return 0;
  }


  return (
    Math.abs(
      candle.close -
      candle.open
    ) /
    range
  );

}


/* ================================================================
   SESSION FILTER
================================================================ */

function sessionAllowed(
  timestamp,
  startHour,
  endHour
) {

  const hour =
    new Date(
      timestamp
    ).getUTCHours();


  /*
   * Standard same-day session
   */

  if (
    startHour <=
    endHour
  ) {

    return (
      hour >=
        startHour &&
      hour <
        endHour
    );

  }


  /*
   * Overnight session
   */

  return (
    hour >=
      startHour ||
    hour <
      endHour
  );

}


/* ================================================================
   PULLBACK DETECTION
================================================================ */

function recentPullback(
  candles,
  index,
  side,
  lookback,
  toleranceATR
) {

  const start =
    Math.max(
      0,
      index -
      lookback +
      1
    );


  for (
    let i = start;
    i <= index;
    i++
  ) {

    const candle =
      candles[i];


    if (
      !Number.isFinite(
        candle.atr14
      ) ||
      !Number.isFinite(
        candle.ema20
      ) ||
      !Number.isFinite(
        candle.ema50
      )
    ) {
      continue;
    }


    const tolerance =
      candle.atr14 *
      toleranceATR;


    if (
      side === 1
    ) {

      const touched20 =
        candle.low <=
        candle.ema20 +
        tolerance;


      const notTooDeep =
        candle.low >=
        candle.ema50 -
        candle.atr14 *
        0.55;


      if (
        touched20 &&
        notTooDeep
      ) {
        return true;
      }

    } else {

      const touched20 =
        candle.high >=
        candle.ema20 -
        tolerance;


      const notTooDeep =
        candle.high <=
        candle.ema50 +
        candle.atr14 *
        0.55;


      if (
        touched20 &&
        notTooDeep
      ) {
        return true;
      }

    }

  }


  return false;

}


/* ================================================================
   SIGNAL SCORE
================================================================ */

function signalScore(
  context,
  side,
  settings
) {

  let score = 0;


  /*
   * H4 macro regime
   * 20 points
   */

  if (
    side === 1
      ? macroBull(
          context.h4
        )
      : macroBear(
          context.h4
        )
  ) {
    score += 20;
  }


  /*
   * H1 alignment
   * 25 points
   */

  if (
    side === 1
      ? fullBull(
          context.h1
        )
      : fullBear(
          context.h1
        )
  ) {
    score += 25;
  }


  /*
   * M15 alignment
   * 25 points
   */

  if (
    side === 1
      ? fullBull(
          context.m15
        )
      : fullBear(
          context.m15
        )
  ) {
    score += 25;
  }


  /*
   * M15 ADX
   * 10 points
   */

  if (
    Number.isFinite(
      context.m15.adx14
    ) &&
    context.m15.adx14 >=
      settings.minADX
  ) {
    score += 10;
  }


  /*
   * M5 alignment
   * 10 points
   */

  if (
    side === 1
      ? fullBull(
          context.m5
        )
      : fullBear(
          context.m5
        )
  ) {
    score += 10;
  }


  /*
   * EMA slope
   * 10 points
   */

  if (
    side === 1 &&
    context.h1.slope20 > 0 &&
    context.m15.slope20 > 0
  ) {

    score += 10;

  }


  if (
    side === -1 &&
    context.h1.slope20 < 0 &&
    context.m15.slope20 < 0
  ) {

    score += 10;

  }


  return score;

}


/* ================================================================
   ENTRY SIGNAL
================================================================ */

function getSignal(
  data,
  index,
  settings
) {

  if (
    index < 5
  ) {
    return null;
  }


  const context =
    getContext(
      data,
      index
    );


  if (!context) {
    return null;
  }


  const current =
    context.m5;


  const previous =
    data.m5[
      index - 1
    ];


  if (
    !Number.isFinite(
      current.atr14
    ) ||
    !Number.isFinite(
      current.rsi14
    ) ||
    !Number.isFinite(
      context.m15.adx14
    )
  ) {

    return null;

  }


  /*
   * Session filter
   */

  if (
    settings.useSession &&
    !sessionAllowed(
      current.ts,
      settings.sessionStart,
      settings.sessionEnd
    )
  ) {

    return null;

  }


  /*
   * Minimum volatility.
   *
   * ATR percentage of price.
   */

  const atrPct =
    (
      current.atr14 /
      current.close
    ) *
    100;


  if (
    atrPct <
    settings.minAtrPct
  ) {

    return null;

  }


  /*
   * Candle strength
   */

  const body =
    bodyStrength(
      current
    );


  if (
    body <
    settings.minBody
  ) {

    return null;

  }


  /* ============================================================
     LONG
  ============================================================ */

  const longTrend =
    macroBull(
      context.h4
    ) &&
    fullBull(
      context.h1
    ) &&
    fullBull(
      context.m15
    );


  if (longTrend) {

    const score =
      signalScore(
        context,
        1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        1,
        settings.pullbackBars,
        settings.pullbackToleranceATR
      );


    const rsiOk =
      current.rsi14 >=
        settings.longRsiMin &&
      current.rsi14 <=
        settings.longRsiMax;


    const adxOk =
      context.m15.adx14 >=
      settings.minADX;


    const continuation =
      current.close >
        previous.high &&
      current.close >
        current.open &&
      current.close >
        current.ema20;


    const chaseDistance =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    const notChasing =
      chaseDistance <=
      settings.maxChaseATR;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOk &&
      adxOk &&
      continuation &&
      notChasing
    ) {

      return {

        side: 1,

        score,

        context

      };

    }

  }


  /* ============================================================
     SHORT
  ============================================================ */

  const shortTrend =
    macroBear(
      context.h4
    ) &&
    fullBear(
      context.h1
    ) &&
    fullBear(
      context.m15
    );


  if (shortTrend) {

    const score =
      signalScore(
        context,
        -1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        -1,
        settings.pullbackBars,
        settings.pullbackToleranceATR
      );


    const rsiOk =
      current.rsi14 >=
        settings.shortRsiMin &&
      current.rsi14 <=
        settings.shortRsiMax;


    const adxOk =
      context.m15.adx14 >=
      settings.minADX;


    const continuation =
      current.close <
        previous.low &&
      current.close <
        current.open &&
      current.close <
        current.ema20;


    const chaseDistance =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    const notChasing =
      chaseDistance <=
      settings.maxChaseATR;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOk &&
      adxOk &&
      continuation &&
      notChasing
    ) {

      return {

        side: -1,

        score,

        context

      };

    }

  }


  return null;

}


/* ================================================================
   STRUCTURAL STOP
================================================================ */

function calculateStop(
  candles,
  signalIndex,
  entry,
  side,
  settings
) {

  const signal =
    candles[
      signalIndex
    ];


  const atrValue =
    signal.atr14;


  if (
    !Number.isFinite(
      atrValue
    )
  ) {
    return null;
  }


  const start =
    Math.max(
      0,
      signalIndex -
      settings.swingLookback +
      1
    );


  let swing;


  if (
    side === 1
  ) {

    swing =
      Infinity;


    for (
      let i = start;
      i <= signalIndex;
      i++
    ) {

      swing =
        Math.min(
          swing,
          candles[i].low
        );

    }


    let stop =
      swing -
      atrValue *
      settings.structureBufferATR;


    let distance =
      entry -
      stop;


    const minDistance =
      atrValue *
      settings.minStopATR;


    const maxDistance =
      atrValue *
      settings.maxStopATR;


    if (
      distance <
      minDistance
    ) {

      distance =
        minDistance;

      stop =
        entry -
        distance;

    }


    if (
      distance >
      maxDistance
    ) {

      return null;

    }


    return {

      stop,

      distance

    };

  }


  swing =
    -Infinity;


  for (
    let i = start;
    i <= signalIndex;
    i++
  ) {

    swing =
      Math.max(
        swing,
        candles[i].high
      );

  }


  let stop =
    swing +
    atrValue *
    settings.structureBufferATR;


  let distance =
    stop -
    entry;


  const minDistance =
    atrValue *
    settings.minStopATR;


  const maxDistance =
    atrValue *
    settings.maxStopATR;


  if (
    distance <
    minDistance
  ) {

    distance =
      minDistance;

    stop =
      entry +
      distance;

  }


  if (
    distance >
    maxDistance
  ) {

    return null;

  }


  return {

    stop,

    distance

  };

}


/* ================================================================
   TRADE SIMULATION
================================================================ */

function simulateTrade(
  data,
  signalIndex,
  signal,
  settings
) {

  const entryIndex =
    signalIndex + 1;


  if (
    entryIndex >=
    data.m5.length
  ) {
    return null;
  }


  const entryBar =
    data.m5[
      entryIndex
    ];


  const entry =
    entryBar.open;


  const stopInfo =
    calculateStop(
      data.m5,
      signalIndex,
      entry,
      signal.side,
      settings
    );


  if (!stopInfo) {
    return null;
  }


  const originalStop =
    stopInfo.stop;


  const riskDistance =
    stopInfo.distance;


  const target =
    signal.side === 1
      ? entry +
        riskDistance *
        settings.targetR
      : entry -
        riskDistance *
        settings.targetR;


  const breakevenTrigger =
    signal.side === 1
      ? entry +
        riskDistance *
        settings.breakevenR
      : entry -
        riskDistance *
        settings.breakevenR;


  let activeStop =
    originalStop;


  let breakevenActive =
    false;


  let exitIndex =
    Math.min(
      data.m5.length - 1,
      entryIndex +
      settings.maxHoldBars
    );


  let exitPrice =
    data.m5[
      exitIndex
    ].close;


  let reason =
    "TIME";


  let rawR = null;


  for (
    let i = entryIndex;
    i <= exitIndex;
    i++
  ) {

    const bar =
      data.m5[i];


    /* ============================================================
       LONG
    ============================================================ */

    if (
      signal.side === 1
    ) {

      const stopHit =
        bar.low <=
        activeStop;


      const targetHit =
        bar.high >=
        target;


      /*
       * Conservative same-bar collision:
       * stop first.
       */

      if (
        stopHit &&
        targetHit
      ) {

        exitIndex = i;

        exitPrice =
          activeStop;

        reason =
          breakevenActive
            ? "BE"
            : "SL";

        rawR =
          breakevenActive
            ? 0
            : -1;

        break;

      }


      if (stopHit) {

        exitIndex = i;

        exitPrice =
          activeStop;

        reason =
          breakevenActive
            ? "BE"
            : "SL";

        rawR =
          breakevenActive
            ? 0
            : -1;

        break;

      }


      if (targetHit) {

        exitIndex = i;

        exitPrice =
          target;

        reason =
          "TP";

        rawR =
          settings.targetR;

        break;

      }


      /*
       * Breakeven starts NEXT candle.
       * More conservative than assuming exact intrabar order.
       */

      if (
        settings.useBreakeven &&
        !breakevenActive &&
        bar.high >=
          breakevenTrigger
      ) {

        breakevenActive =
          true;

        activeStop =
          entry;

      }

    }


    /* ============================================================
       SHORT
    ============================================================ */

    else {

      const stopHit =
        bar.high >=
        activeStop;


      const targetHit =
        bar.low <=
        target;


      if (
        stopHit &&
        targetHit
      ) {

        exitIndex = i;

        exitPrice =
          activeStop;

        reason =
          breakevenActive
            ? "BE"
            : "SL";

        rawR =
          breakevenActive
            ? 0
            : -1;

        break;

      }


      if (stopHit) {

        exitIndex = i;

        exitPrice =
          activeStop;

        reason =
          breakevenActive
            ? "BE"
            : "SL";

        rawR =
          breakevenActive
            ? 0
            : -1;

        break;

      }


      if (targetHit) {

        exitIndex = i;

        exitPrice =
          target;

        reason =
          "TP";

        rawR =
          settings.targetR;

        break;

      }


      if (
        settings.useBreakeven &&
        !breakevenActive &&
        bar.low <=
          breakevenTrigger
      ) {

        breakevenActive =
          true;

        activeStop =
          entry;

      }

    }

  }


  /*
   * Time exit.
   */

  if (
    rawR === null
  ) {

    rawR =
      signal.side === 1
        ? (
            exitPrice -
            entry
          ) /
          riskDistance
        : (
            entry -
            exitPrice
          ) /
          riskDistance;

  }


  const netR =
    rawR -
    settings.costR;


  return {

    side:
      signal.side === 1
        ? "BUY"
        : "SELL",

    score:
      signal.score,

    signalTime:
      new Date(
        data.m5[
          signalIndex
        ].closeTs
      ).toISOString(),

    entryTime:
      new Date(
        entryBar.ts
      ).toISOString(),

    exitTime:
      new Date(
        data.m5[
          exitIndex
        ].closeTs
      ).toISOString(),

    entry:
      round(
        entry,
        4
      ),

    stopLoss:
      round(
        originalStop,
        4
      ),

    target:
      round(
        target,
        4
      ),

    exit:
      round(
        exitPrice,
        4
      ),

    riskDistance:
      round(
        riskDistance,
        4
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

    result:
      reason,

    holdBars:
      exitIndex -
      entryIndex +
      1,

    exitIndex

  };

}


/* ================================================================
   METRICS
================================================================ */

function metrics(
  trades,
  settings
) {

  let wins = 0;
  let losses = 0;
  let breakevens = 0;

  let buyTrades = 0;
  let sellTrades = 0;

  let grossProfit = 0;
  let grossLoss = 0;

  let totalR = 0;

  let equity =
    settings.initialBalance;


  let peak =
    equity;


  let maxDD = 0;


  let winStreak = 0;
  let lossStreak = 0;

  let maxWinStreak = 0;
  let maxLossStreak = 0;


  const curve = [
    {
      trade: 0,
      equity:
        round(
          equity,
          2
        )
    }
  ];


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


    if (
      trade.side ===
      "BUY"
    ) {

      buyTrades++;

    } else {

      sellTrades++;

    }


    if (
      r > 0
    ) {

      wins++;

      grossProfit += r;

      winStreak++;

      lossStreak = 0;

      maxWinStreak =
        Math.max(
          maxWinStreak,
          winStreak
        );

    } else if (
      r < 0
    ) {

      losses++;

      grossLoss +=
        Math.abs(r);

      lossStreak++;

      winStreak = 0;

      maxLossStreak =
        Math.max(
          maxLossStreak,
          lossStreak
        );

    } else {

      breakevens++;

      winStreak = 0;
      lossStreak = 0;

    }


    equity *=
      1 +
      (
        r *
        settings.riskPct /
        100
      );


    peak =
      Math.max(
        peak,
        equity
      );


    const dd =
      peak > 0
        ? (
            (
              peak -
              equity
            ) /
            peak
          ) *
          100
        : 0;


    maxDD =
      Math.max(
        maxDD,
        dd
      );


    curve.push({

      trade:
        i + 1,

      equity:
        round(
          equity,
          2
        )

    });

  }


  const count =
    trades.length;


  const winRate =
    count > 0
      ? wins /
        count *
        100
      : 0;


  let profitFactor = 0;


  if (
    grossLoss > 0
  ) {

    profitFactor =
      grossProfit /
      grossLoss;

  } else if (
    grossProfit > 0
  ) {

    profitFactor = 99;

  }


  const expectancy =
    count > 0
      ? totalR /
        count
      : 0;


  const returnPct =
    (
      (
        equity -
        settings.initialBalance
      ) /
      settings.initialBalance
    ) *
    100;


  let grade = "D";

  let verdict =
    "No proven edge yet";


  if (
    count < 20
  ) {

    grade =
      "N/A";

    verdict =
      "Too few trades to judge";

  } else if (
    count >= 40 &&
    profitFactor >= 1.5 &&
    expectancy >= 0.20 &&
    maxDD <= 12
  ) {

    grade =
      "A";

    verdict =
      "Strong historical performance";

  } else if (
    count >= 30 &&
    profitFactor >= 1.25 &&
    expectancy >= 0.10 &&
    maxDD <= 16
  ) {

    grade =
      "B";

    verdict =
      "Promising historical edge";

  } else if (
    profitFactor >= 1.05 &&
    expectancy > 0
  ) {

    grade =
      "C";

    verdict =
      "Positive, but needs improvement";

  }


  return {

    trades:
      count,

    wins,

    losses,

    breakevens,

    buyTrades,

    sellTrades,

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
        expectancy,
        4
      ),

    totalR:
      round(
        totalR,
        2
      ),

    maxDrawdown:
      round(
        maxDD,
        2
      ),

    initialBalance:
      round(
        settings.initialBalance,
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

    maxWinStreak,

    maxLossStreak,

    grade,

    verdict,

    equityCurve:
      curve

  };

}


/* ================================================================
   RUN BACKTEST
================================================================ */

function runBacktest(
  data,
  settings
) {

  const trades = [];


  const startIndex =
    Math.max(
      220,
      data.m5.length -
      settings.testBars
    );


  let i =
    startIndex;


  while (
    i <
    data.m5.length - 1
  ) {

    const signal =
      getSignal(
        data,
        i,
        settings
      );


    if (!signal) {

      i++;

      continue;

    }


    if (
      settings.side ===
        "long" &&
      signal.side !== 1
    ) {

      i++;

      continue;

    }


    if (
      settings.side ===
        "short" &&
      signal.side !== -1
    ) {

      i++;

      continue;

    }


    const trade =
      simulateTrade(
        data,
        i,
        signal,
        settings
      );


    if (!trade) {

      i++;

      continue;

    }


    trades.push(
      trade
    );


    /*
     * One position at a time.
     */

    i =
      trade.exitIndex +
      settings.cooldownBars +
      1;

  }


  return {

    metrics:
      metrics(
        trades,
        settings
      ),

    trades:
      trades
        .slice(-250)
        .reverse()

  };

}


/* ================================================================
   LATEST ANALYSIS
================================================================ */

function latestAnalysis(
  data,
  settings
) {

  const index =
    data.m5.length - 1;


  const context =
    getContext(
      data,
      index
    );


  if (!context) {
    return null;
  }


  const longScore =
    signalScore(
      context,
      1,
      settings
    );


  const shortScore =
    signalScore(
      context,
      -1,
      settings
    );


  let bias =
    "NEUTRAL";


  if (
    longScore >
      shortScore &&
    macroBull(
      context.h4
    ) &&
    fullBull(
      context.h1
    )
  ) {

    bias =
      "BULLISH";

  }


  if (
    shortScore >
      longScore &&
    macroBear(
      context.h4
    ) &&
    fullBear(
      context.h1
    )
  ) {

    bias =
      "BEARISH";

  }


  function tfState(
    candle,
    macro = false
  ) {

    let state =
      "MIXED";


    if (
      macro
        ? macroBull(candle)
        : fullBull(candle)
    ) {

      state =
        "BULLISH";

    }


    if (
      macro
        ? macroBear(candle)
        : fullBear(candle)
    ) {

      state =
        "BEARISH";

    }


    return {

      close:
        round(
          candle.close,
          2
        ),

      ema20:
        round(
          candle.ema20,
          2
        ),

      ema50:
        round(
          candle.ema50,
          2
        ),

      ema200:
        round(
          candle.ema200,
          2
        ),

      rsi:
        round(
          candle.rsi14,
          1
        ),

      adx:
        round(
          candle.adx14,
          1
        ),

      state

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
        2
      ),

    bias,

    longScore,

    shortScore,

    timeframes: {

      m5:
        tfState(
          context.m5
        ),

      m15:
        tfState(
          context.m15
        ),

      h1:
        tfState(
          context.h1
        ),

      h4:
        tfState(
          context.h4,
          true
        )

    }

  };

}


/* ================================================================
   CACHE
================================================================ */

let CACHE = {

  expires: 0,

  bars: null,

  data: null

};


/* ================================================================
   LOAD DATA
================================================================ */

async function loadData(
  testBars
) {

  if (
    CACHE.data &&
    CACHE.bars ===
      testBars &&
    CACHE.expires >
      Date.now()
  ) {

    return CACHE.data;

  }


  /*
   * Warmup included.
   */

  const m5Size =
    Math.min(
      5000,
      testBars + 300
    );


  const m15Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 3
      ) +
      300
    );


  const h1Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 12
      ) +
      300
    );


  const h4Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 48
      ) +
      300
    );


  const [
    m5,
    m15,
    h1,
    h4
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
      decorate(m5),

    m15:
      decorate(m15),

    h1:
      decorate(h1),

    h4:
      decorate(h4)

  };


  CACHE = {

    expires:
      Date.now() +
      45 * 1000,

    bars:
      testBars,

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


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok: false,

        error:
          "GET only"

      });

  }


  if (!TD_KEY) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Add TWELVE_DATA_API_KEY_4 to Vercel."

      });

  }


  try {

    const q =
      req.query || {};


    const settings = {

      testBars:
        integerParam(
          q.bars,
          2500,
          700,
          4500
        ),


      /* ===============================================
         TREND QUALITY
      =============================================== */

      minADX:
        numberParam(
          q.minADX,
          18,
          5,
          50
        ),


      minScore:
        numberParam(
          q.minScore,
          80,
          40,
          100
        ),


      /* ===============================================
         ENTRY
      =============================================== */

      pullbackBars:
        integerParam(
          q.pullbackBars,
          3,
          1,
          10
        ),


      pullbackToleranceATR:
        numberParam(
          q.pullbackToleranceATR,
          0.18,
          0,
          1
        ),


      minBody:
        numberParam(
          q.minBody,
          0.45,
          0.1,
          1
        ),


      maxChaseATR:
        numberParam(
          q.maxChaseATR,
          0.75,
          0.1,
          3
        ),


      longRsiMin:
        numberParam(
          q.longRsiMin,
          48,
          0,
          100
        ),


      longRsiMax:
        numberParam(
          q.longRsiMax,
          68,
          0,
          100
        ),


      shortRsiMin:
        numberParam(
          q.shortRsiMin,
          32,
          0,
          100
        ),


      shortRsiMax:
        numberParam(
          q.shortRsiMax,
          52,
          0,
          100
        ),


      minAtrPct:
        numberParam(
          q.minAtrPct,
          0.025,
          0,
          2
        ),


      /* ===============================================
         STOP
      =============================================== */

      swingLookback:
        integerParam(
          q.swingLookback,
          6,
          2,
          30
        ),


      structureBufferATR:
        numberParam(
          q.structureBufferATR,
          0.15,
          0,
          2
        ),


      minStopATR:
        numberParam(
          q.minStopATR,
          0.80,
          0.2,
          5
        ),


      maxStopATR:
        numberParam(
          q.maxStopATR,
          2.0,
          0.5,
          8
        ),


      /* ===============================================
         TARGET / MANAGEMENT
      =============================================== */

      targetR:
        numberParam(
          q.targetR,
          1.8,
          0.5,
          6
        ),


      useBreakeven:
        boolParam(
          q.useBreakeven,
          true
        ),


      breakevenR:
        numberParam(
          q.breakevenR,
          1.0,
          0.25,
          4
        ),


      maxHoldBars:
        integerParam(
          q.maxHoldBars,
          48,
          5,
          300
        ),


      cooldownBars:
        integerParam(
          q.cooldownBars,
          3,
          0,
          100
        ),


      /* ===============================================
         SESSION
      =============================================== */

      useSession:
        boolParam(
          q.useSession,
          true
        ),


      sessionStart:
        integerParam(
          q.sessionStart,
          6,
          0,
          23
        ),


      sessionEnd:
        integerParam(
          q.sessionEnd,
          18,
          0,
          23
        ),


      /* ===============================================
         ACCOUNT
      =============================================== */

      initialBalance:
        numberParam(
          q.initialBalance,
          10000,
          100,
          100000000
        ),


      riskPct:
        numberParam(
          q.riskPct,
          0.5,
          0.01,
          10
        ),


      costR:
        numberParam(
          q.costR,
          0.04,
          0,
          0.5
        ),


      side:
        stringParam(
          q.side,
          "both"
        )

    };


    if (
      ![
        "both",
        "long",
        "short"
      ].includes(
        settings.side
      )
    ) {

      settings.side =
        "both";

    }


    const data =
      await loadData(
        settings.testBars
      );


    if (
      data.m5.length <
        300 ||
      data.m15.length <
        220 ||
      data.h1.length <
        220 ||
      data.h4.length <
        220
    ) {

      throw new Error(
        "Not enough history returned for EMA200 calculation."
      );

    }


    const result =
      runBacktest(
        data,
        settings
      );


    const latest =
      latestAnalysis(
        data,
        settings
      );


    const startIndex =
      Math.max(
        220,
        data.m5.length -
        settings.testBars
      );


    return res
      .status(200)
      .json({

        ok: true,

        strategy:
          "TYSON TREND PULLBACK V1",

        symbol:
          SYMBOL,

        provider:
          "Twelve Data",

        execution:
          "M5",

        context: [
          "M15",
          "H1",
          "H4"
        ],

        period: {

          start:
            new Date(
              data.m5[
                startIndex
              ].ts
            ).toISOString(),

          end:
            new Date(
              data.m5[
                data.m5.length -
                1
              ].closeTs
            ).toISOString()

        },

        settings,

        latest,

        metrics:
          result.metrics,

        trades:
          result.trades,

        assumptions: [

          "Higher-timeframe data is used only after each candle has closed.",

          "Signals are evaluated on completed M5 candles.",

          "Trades enter on the next M5 open.",

          "When stop and target are touched in the same candle, stop is assumed first.",

          "Breakeven activation takes effect from the following bar.",

          "costR is deducted from every trade.",

          "Historical results do not guarantee future profitability."

        ]

      });


  } catch (
    error
  ) {

    console.error(
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