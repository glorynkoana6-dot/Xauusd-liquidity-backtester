/* ================================================================
   TYSON TRADE AI
   TREND PULLBACK V1.1
   ---------------------------------------------------------------
   /api/backtest.js

   MARKET
   ------
   XAU/USD

   PROVIDER
   --------
   Twelve Data

   ENVIRONMENT VARIABLE
   --------------------
   TWELVE_DATA_API_KEY_4

   FALLBACK
   --------
   TWELVE_DATA_API_KEY

   TIMEFRAMES
   ----------
   M5  = execution
   M15 = local trend
   H1  = primary trend
   H4  = macro regime

   INDICATORS
   ----------
   EMA20
   EMA50
   EMA200
   RSI14
   ATR14
   ADX14

   V1.1
   ----
   - Strict H4 macro regime
   - Strict H1 EMA alignment
   - Relaxed M15 trend alignment
   - Pullback memory increased
   - More responsive entry trigger
   - Next-candle entry
   - Structural ATR stop
   - 1.8R default target
   - 1R breakeven
   - 70/30 validation split
   - Conservative same-candle collision handling

   IMPORTANT
   ---------
   Historical results do not guarantee future results.
================================================================ */


/* ================================================================
   CONFIG
================================================================ */

const TD_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


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
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }


  const power =
    10 ** decimals;


  return (
    Math.round(
      Number(value) *
      power
    ) /
    power
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


  return String(v) ===
    "true";

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
   DATE
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


  const withZone =
    normalized.endsWith("Z")
      ? normalized
      : `${normalized}Z`;


  const ts =
    Date.parse(
      withZone
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

  const result =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length
  ) {
    return result;
  }


  let seed = 0;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed +=
      values[i];

  }


  seed /=
    length;


  result[
    length - 1
  ] =
    seed;


  const multiplier =
    2 /
    (
      length + 1
    );


  for (
    let i = length;
    i < values.length;
    i++
  ) {

    result[i] =
      (
        values[i] -
        result[
          i - 1
        ]
      ) *
        multiplier +
      result[
        i - 1
      ];

  }


  return result;

}


/* ================================================================
   ATR
================================================================ */

function atr(
  candles,
  length = 14
) {

  const trueRange =
    new Array(
      candles.length
    ).fill(null);


  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];


    if (
      i === 0
    ) {

      trueRange[i] =
        candle.high -
        candle.low;

      continue;

    }


    const previousClose =
      candles[
        i - 1
      ].close;


    trueRange[i] =
      Math.max(

        candle.high -
        candle.low,

        Math.abs(
          candle.high -
          previousClose
        ),

        Math.abs(
          candle.low -
          previousClose
        )

      );

  }


  const result =
    new Array(
      candles.length
    ).fill(null);


  if (
    candles.length <
    length
  ) {
    return result;
  }


  let seed = 0;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed +=
      trueRange[i];

  }


  result[
    length - 1
  ] =
    seed / length;


  for (
    let i = length;
    i < candles.length;
    i++
  ) {

    result[i] =
      (
        result[
          i - 1
        ] *
          (
            length - 1
          ) +
        trueRange[i]
      ) /
      length;

  }


  return result;

}


/* ================================================================
   RSI
================================================================ */

function rsi(
  values,
  length = 14
) {

  const result =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length + 1
  ) {
    return result;
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
      values[
        i - 1
      ];


    if (
      change > 0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(
          change
        );

    }

  }


  let avgGain =
    gains /
    length;


  let avgLoss =
    losses /
    length;


  result[length] =
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
      values[
        i - 1
      ];


    const gain =
      change > 0
        ? change
        : 0;


    const loss =
      change < 0
        ? Math.abs(
            change
          )
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


    result[i] =
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


  return result;

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


  const result =
    new Array(
      size
    ).fill(null);


  if (
    size <
    length * 2 + 2
  ) {
    return result;
  }


  const tr =
    new Array(size)
      .fill(0);


  const plusDM =
    new Array(size)
      .fill(0);


  const minusDM =
    new Array(size)
      .fill(0);


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


  let smoothTR = 0;

  let smoothPlus = 0;

  let smoothMinus = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    smoothTR +=
      tr[i];

    smoothPlus +=
      plusDM[i];

    smoothMinus +=
      minusDM[i];

  }


  const dx =
    new Array(size)
      .fill(null);


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


    const sum =
      plusDI +
      minusDI;


    dx[i] =
      sum === 0
        ? 0
        : (
            100 *
            Math.abs(
              plusDI -
              minusDI
            ) /
            sum
          );

  }


  let count = 0;
  let seed = 0;


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
      count <
      length
    ) {

      seed +=
        dx[i];

      count++;


      if (
        count ===
        length
      ) {

        result[i] =
          seed /
          length;

      }


      continue;

    }


    result[i] =
      (
        result[
          i - 1
        ] *
          (
            length - 1
          ) +
        dx[i]
      ) /
      length;

  }


  return result;

}


/* ================================================================
   FETCH DATA
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


  let json;


  try {

    json =
      await response.json();

  } catch {

    throw new Error(
      `${timeframe} returned invalid JSON`
    );

  }


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

      /*
       * Remove candle still forming.
       */
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


  /*
   * Remove duplicate timestamps.
   */

  const unique = [];

  let previousTs =
    null;


  for (
    const candle of
    candles
  ) {

    if (
      candle.ts ===
      previousTs
    ) {
      continue;
    }


    unique.push(
      candle
    );


    previousTs =
      candle.ts;

  }


  return unique;

}


/* ================================================================
   DECORATE DATA
================================================================ */

function decorate(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
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


  const atr14 =
    atr(
      candles,
      14
    );


  const rsi14 =
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
      index
    ) => {

      const slope20 =
        index > 0 &&
        Number.isFinite(
          e20[index]
        ) &&
        Number.isFinite(
          e20[
            index - 1
          ]
        )
          ? (
              e20[index] -
              e20[
                index - 1
              ]
            )
          : null;


      const slope50 =
        index > 0 &&
        Number.isFinite(
          e50[index]
        ) &&
        Number.isFinite(
          e50[
            index - 1
          ]
        )
          ? (
              e50[index] -
              e50[
                index - 1
              ]
            )
          : null;


      return {

        ...candle,

        ema20:
          e20[index],

        ema50:
          e50[index],

        ema200:
          e200[index],

        atr14:
          atr14[index],

        rsi14:
          rsi14[index],

        adx14:
          adx14[index],

        slope20,

        slope50

      };

    }
  );

}


/* ================================================================
   HTF LOOKUP
================================================================ */

function completedIndex(
  candles,
  timestamp
) {

  let left = 0;

  let right =
    candles.length - 1;

  let answer = -1;


  while (
    left <= right
  ) {

    const middle =
      Math.floor(
        (
          left +
          right
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

      left =
        middle + 1;

    } else {

      right =
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


  const time =
    m5.closeTs;


  const m15Index =
    completedIndex(
      data.m15,
      time
    );


  const h1Index =
    completedIndex(
      data.h1,
      time
    );


  const h4Index =
    completedIndex(
      data.h4,
      time
    );


  if (
    m15Index < 0 ||
    h1Index < 0 ||
    h4Index < 0
  ) {

    return null;

  }


  return {

    m5,

    m15:
      data.m15[
        m15Index
      ],

    h1:
      data.h1[
        h1Index
      ],

    h4:
      data.h4[
        h4Index
      ]

  };

}


/* ================================================================
   TREND STATES
================================================================ */

function h4Bull(candle) {

  return (
    candle &&
    candle.ema50 >
      candle.ema200 &&
    candle.close >
      candle.ema50 &&
    candle.slope50 >
      0
  );

}


function h4Bear(candle) {

  return (
    candle &&
    candle.ema50 <
      candle.ema200 &&
    candle.close <
      candle.ema50 &&
    candle.slope50 <
      0
  );

}


function h1Bull(candle) {

  return (
    candle &&
    candle.ema20 >
      candle.ema50 &&
    candle.ema50 >
      candle.ema200 &&
    candle.close >
      candle.ema20 &&
    candle.slope20 >
      0
  );

}


function h1Bear(candle) {

  return (
    candle &&
    candle.ema20 <
      candle.ema50 &&
    candle.ema50 <
      candle.ema200 &&
    candle.close <
      candle.ema20 &&
    candle.slope20 <
      0
  );

}


/*
 * V1.1:
 * M15 does NOT need EMA50 > EMA200.
 *
 * H4/H1 already define macro direction.
 * M15 only has to show local momentum.
 */

function m15Bull(candle) {

  return (
    candle &&
    candle.ema20 >
      candle.ema50 &&
    candle.close >
      candle.ema20 &&
    candle.slope20 >
      0
  );

}


function m15Bear(candle) {

  return (
    candle &&
    candle.ema20 <
      candle.ema50 &&
    candle.close <
      candle.ema20 &&
    candle.slope20 <
      0
  );

}


function m5Bull(candle) {

  return (
    candle &&
    candle.ema20 >
      candle.ema50 &&
    candle.close >
      candle.ema20
  );

}


function m5Bear(candle) {

  return (
    candle &&
    candle.ema20 <
      candle.ema50 &&
    candle.close <
      candle.ema20
  );

}


/* ================================================================
   CANDLE BODY
================================================================ */

function bodyRatio(candle) {

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
   SESSION
================================================================ */

function inSession(
  timestamp,
  startHour,
  endHour
) {

  const hour =
    new Date(
      timestamp
    ).getUTCHours();


  if (
    startHour <
    endHour
  ) {

    return (
      hour >=
        startHour &&
      hour <
        endHour
    );

  }


  return (
    hour >=
      startHour ||
    hour <
      endHour
  );

}


/* ================================================================
   PULLBACK
================================================================ */

function hasRecentPullback(
  candles,
  index,
  side,
  settings
) {

  const start =
    Math.max(
      0,
      index -
      settings.pullbackBars +
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
      settings.pullbackToleranceATR;


    /*
     * Long:
     * touch EMA20 area,
     * but don't collapse too far through EMA50.
     */

    if (
      side === 1
    ) {

      const touched =
        candle.low <=
        candle.ema20 +
        tolerance;


      const held =
        candle.low >=
        candle.ema50 -
        candle.atr14 *
        0.60;


      if (
        touched &&
        held
      ) {

        return true;

      }

    }


    /*
     * Short.
     */

    else {

      const touched =
        candle.high >=
        candle.ema20 -
        tolerance;


      const held =
        candle.high <=
        candle.ema50 +
        candle.atr14 *
        0.60;


      if (
        touched &&
        held
      ) {

        return true;

      }

    }

  }


  return false;

}


/* ================================================================
   SETUP SCORE
================================================================ */

function setupScore(
  context,
  side,
  settings
) {

  let score = 0;


  /*
   * H4 macro = 25
   */

  if (
    side === 1
      ? h4Bull(
          context.h4
        )
      : h4Bear(
          context.h4
        )
  ) {

    score +=
      25;

  }


  /*
   * H1 full trend = 25
   */

  if (
    side === 1
      ? h1Bull(
          context.h1
        )
      : h1Bear(
          context.h1
        )
  ) {

    score +=
      25;

  }


  /*
   * M15 local trend = 20
   */

  if (
    side === 1
      ? m15Bull(
          context.m15
        )
      : m15Bear(
          context.m15
        )
  ) {

    score +=
      20;

  }


  /*
   * ADX = 10
   */

  if (
    Number.isFinite(
      context.m15.adx14
    ) &&
    context.m15.adx14 >=
      settings.minADX
  ) {

    score +=
      10;

  }


  /*
   * M5 EMA trend = 10
   */

  if (
    side === 1
      ? m5Bull(
          context.m5
        )
      : m5Bear(
          context.m5
        )
  ) {

    score +=
      10;

  }


  /*
   * H1 + M15 slopes = 10
   */

  if (
    side === 1 &&
    context.h1.slope20 > 0 &&
    context.m15.slope20 > 0
  ) {

    score +=
      10;

  }


  if (
    side === -1 &&
    context.h1.slope20 < 0 &&
    context.m15.slope20 < 0
  ) {

    score +=
      10;

  }


  return score;

}


/* ================================================================
   SIGNAL
================================================================ */

function getSignal(
  data,
  index,
  settings
) {

  if (
    index < 6
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
   * Session.
   */

  if (
    settings.useSession &&
    !inSession(
      current.ts,
      settings.sessionStart,
      settings.sessionEnd
    )
  ) {

    return null;

  }


  /*
   * Volatility.
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
   * Entry candle body.
   */

  if (
    bodyRatio(
      current
    ) <
    settings.minBody
  ) {

    return null;

  }


  /*
   * ADX hard filter.
   */

  if (
    context.m15.adx14 <
    settings.minADX
  ) {

    return null;

  }


  /* ============================================================
     LONG
  ============================================================ */

  const longTrend =
    h4Bull(
      context.h4
    ) &&
    h1Bull(
      context.h1
    ) &&
    m15Bull(
      context.m15
    );


  if (longTrend) {

    const score =
      setupScore(
        context,
        1,
        settings
      );


    const pullback =
      hasRecentPullback(
        data.m5,
        index,
        1,
        settings
      );


    const rsiOK =
      current.rsi14 >=
        settings.longRsiMin &&
      current.rsi14 <=
        settings.longRsiMax;


    const continuation =
      current.close >
        previous.high &&
      current.close >
        current.open &&
      current.close >
        current.ema20;


    const chase =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOK &&
      continuation &&
      chase <=
        settings.maxChaseATR
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
    h4Bear(
      context.h4
    ) &&
    h1Bear(
      context.h1
    ) &&
    m15Bear(
      context.m15
    );


  if (shortTrend) {

    const score =
      setupScore(
        context,
        -1,
        settings
      );


    const pullback =
      hasRecentPullback(
        data.m5,
        index,
        -1,
        settings
      );


    const rsiOK =
      current.rsi14 >=
        settings.shortRsiMin &&
      current.rsi14 <=
        settings.shortRsiMax;


    const continuation =
      current.close <
        previous.low &&
      current.close <
        current.open &&
      current.close <
        current.ema20;


    const chase =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOK &&
      continuation &&
      chase <=
        settings.maxChaseATR
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
   STOP LOSS
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


  if (
    side === 1
  ) {

    let swingLow =
      Infinity;


    for (
      let i = start;
      i <= signalIndex;
      i++
    ) {

      swingLow =
        Math.min(
          swingLow,
          candles[i].low
        );

    }


    let stop =
      swingLow -
      atrValue *
      settings.structureBufferATR;


    let distance =
      entry -
      stop;


    const minimum =
      atrValue *
      settings.minStopATR;


    const maximum =
      atrValue *
      settings.maxStopATR;


    if (
      distance <
      minimum
    ) {

      distance =
        minimum;

      stop =
        entry -
        distance;

    }


    if (
      distance >
      maximum
    ) {
      return null;
    }


    return {
      stop,
      distance
    };

  }


  let swingHigh =
    -Infinity;


  for (
    let i = start;
    i <= signalIndex;
    i++
  ) {

    swingHigh =
      Math.max(
        swingHigh,
        candles[i].high
      );

  }


  let stop =
    swingHigh +
    atrValue *
    settings.structureBufferATR;


  let distance =
    stop -
    entry;


  const minimum =
    atrValue *
    settings.minStopATR;


  const maximum =
    atrValue *
    settings.maxStopATR;


  if (
    distance <
    minimum
  ) {

    distance =
      minimum;

    stop =
      entry +
      distance;

  }


  if (
    distance >
    maximum
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


  const risk =
    stopInfo.distance;


  const target =
    signal.side === 1
      ? entry +
        risk *
        settings.targetR
      : entry -
        risk *
        settings.targetR;


  const breakevenTrigger =
    signal.side === 1
      ? entry +
        risk *
        settings.breakevenR
      : entry -
        risk *
        settings.breakevenR;


  let activeStop =
    originalStop;


  let breakevenActive =
    false;


  const finalAllowedIndex =
    Math.min(

      data.m5.length - 1,

      entryIndex +
      settings.maxHoldBars

    );


  let exitIndex =
    finalAllowedIndex;


  let exitPrice =
    data.m5[
      exitIndex
    ].close;


  let result =
    "TIME";


  let rawR =
    null;


  for (
    let i = entryIndex;
    i <= finalAllowedIndex;
    i++
  ) {

    const bar =
      data.m5[i];


    /* ============================================================
       BUY
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
       * Conservative:
       * if both happen in same candle,
       * assume stop happened first.
       */

      if (
        stopHit &&
        targetHit
      ) {

        exitIndex = i;

        exitPrice =
          activeStop;


        rawR =
          breakevenActive
            ? 0
            : -1;


        result =
          breakevenActive
            ? "BE"
            : "SL";


        break;

      }


      if (stopHit) {

        exitIndex = i;

        exitPrice =
          activeStop;


        rawR =
          breakevenActive
            ? 0
            : -1;


        result =
          breakevenActive
            ? "BE"
            : "SL";


        break;

      }


      if (targetHit) {

        exitIndex = i;

        exitPrice =
          target;


        rawR =
          settings.targetR;


        result =
          "TP";


        break;

      }


      /*
       * Breakeven only becomes active
       * for following candles.
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
       SELL
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


        rawR =
          breakevenActive
            ? 0
            : -1;


        result =
          breakevenActive
            ? "BE"
            : "SL";


        break;

      }


      if (stopHit) {

        exitIndex = i;

        exitPrice =
          activeStop;


        rawR =
          breakevenActive
            ? 0
            : -1;


        result =
          breakevenActive
            ? "BE"
            : "SL";


        break;

      }


      if (targetHit) {

        exitIndex = i;

        exitPrice =
          target;


        rawR =
          settings.targetR;


        result =
          "TP";


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
   * Timed exit.
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
          risk
        : (
            entry -
            exitPrice
          ) /
          risk;

  }


  /*
   * Trading cost approximation.
   */

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

    signalIndex,

    entryIndex,

    exitIndex,

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
        risk,
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

    result,

    holdBars:
      exitIndex -
      entryIndex +
      1

  };

}


/* ================================================================
   METRICS
================================================================ */

function calculateMetrics(
  trades,
  settings
) {

  let wins = 0;

  let losses = 0;

  let breakevens = 0;

  let buys = 0;

  let sells = 0;

  let grossProfitR = 0;

  let grossLossR = 0;

  let totalR = 0;


  let equity =
    settings.initialBalance;


  let peakEquity =
    equity;


  let maxDrawdown =
    0;


  let winStreak =
    0;


  let lossStreak =
    0;


  let maxWinStreak =
    0;


  let maxLossStreak =
    0;


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


  for (
    let i = 0;
    i < trades.length;
    i++
  ) {

    const trade =
      trades[i];


    const r =
      trade.netR;


    totalR +=
      r;


    if (
      trade.side ===
      "BUY"
    ) {

      buys++;

    } else {

      sells++;

    }


    if (
      r > 0
    ) {

      wins++;

      grossProfitR +=
        r;

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

      grossLossR +=
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


    /*
     * Fixed fractional position sizing.
     */

    equity *=
      1 +
      (
        r *
        settings.riskPct /
        100
      );


    peakEquity =
      Math.max(
        peakEquity,
        equity
      );


    const drawdown =
      (
        (
          peakEquity -
          equity
        ) /
        peakEquity
      ) *
      100;


    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
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


  const count =
    trades.length;


  const winRate =
    count > 0
      ? wins /
        count *
        100
      : 0;


  const profitFactor =
    grossLossR > 0
      ? grossProfitR /
        grossLossR
      : grossProfitR > 0
        ? 99
        : 0;


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


  return {

    trades:
      count,

    wins,

    losses,

    breakevens,

    buys,

    sells,

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
        maxDrawdown,
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

    equityCurve

  };

}


/* ================================================================
   GRADE
================================================================ */

function gradeStrategy(
  all,
  validation
) {

  /*
   * We deliberately refuse to give
   * a strong grade to tiny samples.
   */

  if (
    all.trades <
    20
  ) {

    return {

      grade:
        "N/A",

      verdict:
        "Insufficient sample — keep testing"

    };

  }


  /*
   * Strong.
   */

  if (
    all.trades >= 40 &&
    all.profitFactor >= 1.45 &&
    all.expectancyR >= 0.18 &&
    all.maxDrawdown <= 12 &&
    validation.trades >= 8 &&
    validation.profitFactor >= 1.15 &&
    validation.expectancyR > 0
  ) {

    return {

      grade:
        "A",

      verdict:
        "Strong historical test with positive validation"

    };

  }


  /*
   * Promising.
   */

  if (
    all.trades >= 30 &&
    all.profitFactor >= 1.25 &&
    all.expectancyR >= 0.10 &&
    all.maxDrawdown <= 16 &&
    validation.expectancyR >= 0
  ) {

    return {

      grade:
        "B",

      verdict:
        "Promising historical edge"

    };

  }


  if (
    all.profitFactor >
      1.05 &&
    all.expectancyR >
      0
  ) {

    return {

      grade:
        "C",

      verdict:
        "Positive overall but not yet robust"

    };

  }


  return {

    grade:
      "D",

    verdict:
      "No reliable historical edge"

  };

}


/* ================================================================
   BACKTEST
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


  let index =
    startIndex;


  while (
    index <
    data.m5.length - 1
  ) {

    const signal =
      getSignal(
        data,
        index,
        settings
      );


    if (!signal) {

      index++;

      continue;

    }


    if (
      settings.side ===
        "long" &&
      signal.side !==
        1
    ) {

      index++;

      continue;

    }


    if (
      settings.side ===
        "short" &&
      signal.side !==
        -1
    ) {

      index++;

      continue;

    }


    const trade =
      simulateTrade(

        data,

        index,

        signal,

        settings

      );


    if (!trade) {

      index++;

      continue;

    }


    trades.push(
      trade
    );


    /*
     * One position at a time.
     */

    index =
      trade.exitIndex +
      settings.cooldownBars +
      1;

  }


  /*
   * 70/30 TIME SPLIT
   *
   * This is not parameter optimization.
   * It simply shows whether the later
   * segment behaves similarly.
   */

  const startTs =
    data.m5[
      startIndex
    ].ts;


  const endTs =
    data.m5[
      data.m5.length - 1
    ].closeTs;


  const splitTs =
    startTs +
    (
      endTs -
      startTs
    ) *
    0.70;


  const trainingTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) <
        splitTs
    );


  const validationTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) >=
        splitTs
    );


  const allMetrics =
    calculateMetrics(
      trades,
      settings
    );


  const trainingMetrics =
    calculateMetrics(
      trainingTrades,
      settings
    );


  const validationMetrics =
    calculateMetrics(
      validationTrades,
      settings
    );


  const grade =
    gradeStrategy(
      allMetrics,
      validationMetrics
    );


  return {

    trades,

    metrics: {

      ...allMetrics,

      grade:
        grade.grade,

      verdict:
        grade.verdict

    },

    training:
      trainingMetrics,

    validation:
      validationMetrics,

    splitTime:
      new Date(
        splitTs
      ).toISOString()

  };

}


/* ================================================================
   LATEST MARKET STATE
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
    setupScore(
      context,
      1,
      settings
    );


  const shortScore =
    setupScore(
      context,
      -1,
      settings
    );


  let bias =
    "NEUTRAL";


  if (
    h4Bull(
      context.h4
    ) &&
    h1Bull(
      context.h1
    )
  ) {

    bias =
      "BULLISH";

  }


  if (
    h4Bear(
      context.h4
    ) &&
    h1Bear(
      context.h1
    )
  ) {

    bias =
      "BEARISH";

  }


  function state(
    candle,
    timeframe
  ) {

    let direction =
      "MIXED";


    if (
      timeframe ===
      "h4"
    ) {

      if (
        h4Bull(candle)
      ) {
        direction =
          "BULLISH";
      }


      if (
        h4Bear(candle)
      ) {
        direction =
          "BEARISH";
      }

    }


    if (
      timeframe ===
      "h1"
    ) {

      if (
        h1Bull(candle)
      ) {
        direction =
          "BULLISH";
      }


      if (
        h1Bear(candle)
      ) {
        direction =
          "BEARISH";
      }

    }


    if (
      timeframe ===
      "m15"
    ) {

      if (
        m15Bull(candle)
      ) {
        direction =
          "BULLISH";
      }


      if (
        m15Bear(candle)
      ) {
        direction =
          "BEARISH";
      }

    }


    if (
      timeframe ===
      "m5"
    ) {

      if (
        m5Bull(candle)
      ) {
        direction =
          "BULLISH";
      }


      if (
        m5Bear(candle)
      ) {
        direction =
          "BEARISH";
      }

    }


    return {

      direction,

      price:
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
        )

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
        state(
          context.m5,
          "m5"
        ),

      m15:
        state(
          context.m15,
          "m15"
        ),

      h1:
        state(
          context.h1,
          "h1"
        ),

      h4:
        state(
          context.h4,
          "h4"
        )

    }

  };

}


/* ================================================================
   CACHE
================================================================ */

let CACHE = {

  key: null,

  expires: 0,

  data: null

};


/* ================================================================
   LOAD DATA
================================================================ */

async function loadData(
  requestedBars
) {

  const m5Size =
    Math.min(
      5000,
      requestedBars +
      300
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


  /*
   * More H4 than mathematically required
   * to give EMA200 proper warm-up.
   */

  const h4Size =
    Math.max(
      400,

      Math.ceil(
        m5Size / 48
      ) +
      260
    );


  const key =
    [
      m5Size,
      m15Size,
      h1Size,
      h4Size
    ].join("-");


  if (
    CACHE.key ===
      key &&
    CACHE.data &&
    CACHE.expires >
      Date.now()
  ) {

    return CACHE.data;

  }


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

    key,

    expires:
      Date.now() +
      45 * 1000,

    data

  };


  return data;

}


/* ================================================================
   HANDLER
================================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate"
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
          "Missing TWELVE_DATA_API_KEY_4 in Vercel."

      });

  }


  try {

    const q =
      req.query || {};


    const settings = {

      /* =======================================================
         HISTORY
      ======================================================= */

      testBars:
        integerParam(
          q.bars,
          4500,
          700,
          4700
        ),


      /* =======================================================
         TREND QUALITY
      ======================================================= */

      minScore:
        numberParam(
          q.minScore,
          76,
          50,
          100
        ),


      minADX:
        numberParam(
          q.minADX,
          16,
          5,
          50
        ),


      /* =======================================================
         PULLBACK
      ======================================================= */

      pullbackBars:
        integerParam(
          q.pullbackBars,
          5,
          1,
          12
        ),


      pullbackToleranceATR:
        numberParam(
          q.pullbackToleranceATR,
          0.22,
          0,
          1
        ),


      /* =======================================================
         ENTRY
      ======================================================= */

      minBody:
        numberParam(
          q.minBody,
          0.35,
          0.1,
          1
        ),


      maxChaseATR:
        numberParam(
          q.maxChaseATR,
          0.90,
          0.1,
          3
        ),


      longRsiMin:
        numberParam(
          q.longRsiMin,
          46,
          0,
          100
        ),


      longRsiMax:
        numberParam(
          q.longRsiMax,
          70,
          0,
          100
        ),


      shortRsiMin:
        numberParam(
          q.shortRsiMin,
          30,
          0,
          100
        ),


      shortRsiMax:
        numberParam(
          q.shortRsiMax,
          54,
          0,
          100
        ),


      minAtrPct:
        numberParam(
          q.minAtrPct,
          0.02,
          0,
          2
        ),


      /* =======================================================
         STOP
      ======================================================= */

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


      /* =======================================================
         TRADE MANAGEMENT
      ======================================================= */

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
          2,
          0,
          100
        ),


      /* =======================================================
         SESSION
      ======================================================= */

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


      /* =======================================================
         ACCOUNT
      ======================================================= */

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
        "Not enough history returned for EMA200."
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
          "TYSON TREND PULLBACK V1.1",

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

        splitTime:
          result.splitTime,

        settings,

        latest,

        metrics:
          result.metrics,

        training:
          result.training,

        validation:
          result.validation,

        trades:
          result.trades
            .slice(-300)
            .reverse(),

        assumptions: [

          "Only completed M5 candles create signals.",

          "Higher-timeframe candles are unavailable until they have closed.",

          "Trade entry occurs on the next M5 open.",

          "When stop and target occur inside the same candle, stop is assumed first.",

          "Breakeven becomes active only for following candles.",

          "Trading cost is approximated using costR.",

          "The 70/30 split is a robustness check, not proof of future profitability."

        ]

      });


  } catch (
    error
  ) {

    console.error(
      "BACKTEST ERROR:",
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