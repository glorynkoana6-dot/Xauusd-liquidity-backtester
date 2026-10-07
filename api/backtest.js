/* ================================================================
   TYSON TRADE AI
   TREND PULLBACK V1.3
   ROBUST WALK-FORWARD BACKTEST ENGINE

   FILE
   ----
   /api/backtest.js

   MARKET
   ------
   XAU/USD

   PROVIDER
   --------
   Twelve Data

   ENVIRONMENT VARIABLES
   ---------------------
   TWELVE_DATA_API_KEY_4

   FALLBACK
   --------
   TWELVE_DATA_API_KEY

   DATA ARCHITECTURE
   -----------------
   Download M5 history.
   Build M15 / H1 / H4 locally from M5.

   BENEFITS
   --------
   - Same underlying feed
   - Exact timestamp synchronization
   - Lower API usage
   - No HTF data mismatch
   - Easier long-history testing

   BACKTEST
   --------
   First 70%  = development
   Last 30%   = untouched validation

   IMPORTANT
   ---------
   Mode selection uses DEVELOPMENT DATA ONLY.

   Validation performance is NEVER used to select the best mode.

   ENTRY
   -----
   Signal on completed M5 candle.
   Entry on NEXT M5 open.

   EXIT
   ----
   Structural + ATR stop.
   Default target = 1.8R.
   Breakeven after +1R.

   COST
   ----
   Default trading cost = 0.04R per trade.

   DISCLAIMER
   ----------
   Historical performance does not guarantee future profitability.
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


const M5_MS =
  5 * 60 * 1000;


const TF_MS = {

  m5:
    5 * 60 * 1000,

  m15:
    15 * 60 * 1000,

  h1:
    60 * 60 * 1000,

  h4:
    4 * 60 * 60 * 1000

};


const CHUNK_SIZE =
  5000;


const MAX_CHUNKS =
  6;


/*
 * H4 EMA200 requires roughly
 * 200 * 48 = 9600 M5 bars.
 *
 * Give it some safety margin.
 */

const WARMUP_M5_BARS =
  10500;


/* ================================================================
   BASIC HELPERS
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


  const factor =
    10 ** decimals;


  return (
    Math.round(
      Number(value) *
      factor
    ) /
    factor
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

  const raw =
    first(value);


  if (
    raw === undefined ||
    raw === null
  ) {

    return fallback;

  }


  return (
    String(raw) ===
    "true"
  );

}


/* ================================================================
   DATETIME
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


function twelveDate(
  timestamp
) {

  return new Date(
    timestamp
  )
    .toISOString()
    .slice(
      0,
      19
    )
    .replace(
      "T",
      " "
    );

}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  length
) {

  const output =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length
  ) {

    return output;

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


  output[
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

    output[i] =
      (
        values[i] -
        output[
          i - 1
        ]
      ) *
        multiplier +
      output[
        i - 1
      ];

  }


  return output;

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


  const output =
    new Array(
      candles.length
    ).fill(null);


  if (
    candles.length <
    length
  ) {

    return output;

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


  output[
    length - 1
  ] =
    seed /
    length;


  for (
    let i = length;
    i < candles.length;
    i++
  ) {

    output[i] =
      (
        output[
          i - 1
        ] *
          (
            length - 1
          ) +
        trueRange[i]
      ) /
      length;

  }


  return output;

}


/* ================================================================
   RSI
================================================================ */

function rsi(
  values,
  length = 14
) {

  const output =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length + 1
  ) {

    return output;

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


  let averageGain =
    gains /
    length;


  let averageLoss =
    losses /
    length;


  output[length] =
    averageLoss === 0
      ? 100
      : 100 -
        (
          100 /
          (
            1 +
            averageGain /
            averageLoss
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


    averageGain =
      (
        averageGain *
          (
            length - 1
          ) +
        gain
      ) /
      length;


    averageLoss =
      (
        averageLoss *
          (
            length - 1
          ) +
        loss
      ) /
      length;


    output[i] =
      averageLoss === 0
        ? 100
        : 100 -
          (
            100 /
            (
              1 +
              averageGain /
              averageLoss
            )
          );

  }


  return output;

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


  const output =
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


  if (
    size <
    length * 2 + 2
  ) {

    return output;

  }


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
    new Array(
      size
    ).fill(null);


  for (
    let i = length;
    i < size;
    i++
  ) {

    if (
      i >
      length
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


    const total =
      plusDI +
      minusDI;


    dx[i] =
      total === 0
        ? 0
        : (
            100 *
            Math.abs(
              plusDI -
              minusDI
            ) /
            total
          );

  }


  let seed = 0;

  let seedCount = 0;


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
      seedCount <
      length
    ) {

      seed +=
        dx[i];

      seedCount++;


      if (
        seedCount ===
        length
      ) {

        output[i] =
          seed /
          length;

      }


      continue;

    }


    output[i] =
      (
        output[
          i - 1
        ] *
          (
            length - 1
          ) +
        dx[i]
      ) /
      length;

  }


  return output;

}


/* ================================================================
   TWELVE DATA PAGE
================================================================ */

async function fetchM5Page(
  outputsize,
  endDate = null
) {

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
    "5min"
  );


  url.searchParams.set(
    "outputsize",
    String(
      outputsize
    )
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


  if (
    endDate !== null
  ) {

    url.searchParams.set(
      "end_date",
      twelveDate(
        endDate
      )
    );

  }


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
      "Twelve Data returned invalid JSON."
    );

  }


  if (
    !response.ok ||
    json?.status ===
      "error"
  ) {

    throw new Error(
      json?.message ||
      `Twelve Data HTTP ${response.status}`
    );

  }


  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      "No M5 candles returned."
    );

  }


  const now =
    Date.now();


  return json.values

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
            M5_MS,

          open,
          high,
          low,
          close

        };

      }
    )

    .filter(Boolean)

    /*
     * Do not include the live M5 candle.
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

}


/* ================================================================
   PAGINATED M5 HISTORY
================================================================ */

async function fetchM5History(
  targetBars
) {

  const all =
    [];


  let endDate =
    null;


  let previousOldest =
    null;


  for (
    let chunk = 0;
    chunk < MAX_CHUNKS;
    chunk++
  ) {

    const stillNeeded =
      targetBars -
      all.length;


    if (
      stillNeeded <= 0
    ) {

      break;

    }


    const requestSize =
      Math.min(
        CHUNK_SIZE,
        Math.max(
          500,
          stillNeeded
        )
      );


    const page =
      await fetchM5Page(
        requestSize,
        endDate
      );


    if (
      !page.length
    ) {

      break;

    }


    all.push(
      ...page
    );


    const oldest =
      page[0].ts;


    /*
     * Protect against API returning
     * the same page repeatedly.
     */

    if (
      previousOldest !== null &&
      oldest >=
        previousOldest
    ) {

      break;

    }


    previousOldest =
      oldest;


    /*
     * Ask for data before
     * the oldest candle returned.
     */

    endDate =
      oldest -
      1000;

  }


  /*
   * Deduplicate.
   */

  const map =
    new Map();


  for (
    const candle of
    all
  ) {

    map.set(
      candle.ts,
      candle
    );

  }


  const candles =
    Array.from(
      map.values()
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
   * Keep latest requested amount.
   */

  if (
    candles.length >
    targetBars
  ) {

    return candles.slice(
      candles.length -
      targetBars
    );

  }


  return candles;

}


/* ================================================================
   AGGREGATE M5 -> HIGHER TIMEFRAMES
================================================================ */

function aggregateCandles(
  source,
  timeframeMs
) {

  if (
    !source.length
  ) {

    return [];

  }


  const buckets =
    new Map();


  for (
    const candle of
    source
  ) {

    const bucketTs =
      Math.floor(
        candle.ts /
        timeframeMs
      ) *
      timeframeMs;


    let bar =
      buckets.get(
        bucketTs
      );


    if (!bar) {

      bar = {

        ts:
          bucketTs,

        closeTs:
          bucketTs +
          timeframeMs,

        open:
          candle.open,

        high:
          candle.high,

        low:
          candle.low,

        close:
          candle.close,

        count:
          1

      };


      buckets.set(
        bucketTs,
        bar
      );

      continue;

    }


    bar.high =
      Math.max(
        bar.high,
        candle.high
      );


    bar.low =
      Math.min(
        bar.low,
        candle.low
      );


    bar.close =
      candle.close;


    bar.count++;

  }


  const output =
    Array.from(
      buckets.values()
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
   * The first bucket may be incomplete
   * because downloaded history can begin
   * part way through an HTF candle.
   */

  if (
    output.length >
    1
  ) {

    output.shift();

  }


  return output;

}


/* ================================================================
   DECORATE CANDLES
================================================================ */

function decorate(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const ema20 =
    ema(
      closes,
      20
    );


  const ema50 =
    ema(
      closes,
      50
    );


  const ema200 =
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
          ema20[index]
        ) &&
        Number.isFinite(
          ema20[
            index - 1
          ]
        )
          ? (
              ema20[index] -
              ema20[
                index - 1
              ]
            )
          : null;


      const slope50 =
        index > 0 &&
        Number.isFinite(
          ema50[index]
        ) &&
        Number.isFinite(
          ema50[
            index - 1
          ]
        )
          ? (
              ema50[index] -
              ema50[
                index - 1
              ]
            )
          : null;


      return {

        ...candle,

        ema20:
          ema20[index],

        ema50:
          ema50[index],

        ema200:
          ema200[index],

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
   BUILD ALL TIMEFRAMES
================================================================ */

function buildData(
  rawM5
) {

  const rawM15 =
    aggregateCandles(
      rawM5,
      TF_MS.m15
    );


  const rawH1 =
    aggregateCandles(
      rawM5,
      TF_MS.h1
    );


  const rawH4 =
    aggregateCandles(
      rawM5,
      TF_MS.h4
    );


  return {

    m5:
      decorate(
        rawM5
      ),

    m15:
      decorate(
        rawM15
      ),

    h1:
      decorate(
        rawH1
      ),

    h4:
      decorate(
        rawH4
      )

  };

}


/* ================================================================
   COMPLETED HTF LOOKUP
================================================================ */

function completedIndex(
  candles,
  timestamp
) {

  let left = 0;

  let right =
    candles.length -
    1;


  let result =
    -1;


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

      result =
        middle;

      left =
        middle +
        1;

    } else {

      right =
        middle -
        1;

    }

  }


  return result;

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


  const timestamp =
    m5.closeTs;


  const m15Index =
    completedIndex(
      data.m15,
      timestamp
    );


  const h1Index =
    completedIndex(
      data.h1,
      timestamp
    );


  const h4Index =
    completedIndex(
      data.h4,
      timestamp
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
   VALID CONTEXT
================================================================ */

function validContext(
  context
) {

  if (!context) {
    return false;
  }


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


    if (
      !Number.isFinite(
        candle.ema20
      ) ||
      !Number.isFinite(
        candle.ema50
      ) ||
      !Number.isFinite(
        candle.ema200
      )
    ) {

      return false;

    }

  }


  return true;

}


/* ================================================================
   FIRST VALID M5 INDEX
================================================================ */

function firstValidIndex(
  data
) {

  for (
    let i = 0;
    i < data.m5.length;
    i++
  ) {

    const context =
      getContext(
        data,
        i
      );


    if (
      validContext(
        context
      )
    ) {

      return i;

    }

  }


  return -1;

}


/* ================================================================
   TREND CONDITIONS
================================================================ */

function h4Bull(c) {

  return (
    c &&
    c.ema50 >
      c.ema200 &&
    c.close >
      c.ema50
  );

}


function h4Bear(c) {

  return (
    c &&
    c.ema50 <
      c.ema200 &&
    c.close <
      c.ema50
  );

}


function h1Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.ema50 >
      c.ema200 &&
    c.close >
      c.ema20
  );

}


function h1Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.ema50 <
      c.ema200 &&
    c.close <
      c.ema20
  );

}


function m15Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.close >
      c.ema20
  );

}


function m15Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.close <
      c.ema20
  );

}


function m5Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.close >
      c.ema20
  );

}


function m5Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.close <
      c.ema20
  );

}


/* ================================================================
   BODY
================================================================ */

function bodyRatio(
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

function recentPullback(
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


    if (
      side === 1
    ) {

      const touched =
        candle.low <=
        candle.ema20 +
        tolerance;


      const depthOkay =
        candle.low >=
        candle.ema50 -
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touched &&
        depthOkay
      ) {

        return true;

      }

    } else {

      const touched =
        candle.high >=
        candle.ema20 -
        tolerance;


      const depthOkay =
        candle.high <=
        candle.ema50 +
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touched &&
        depthOkay
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
   * Macro regime
   * 25
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
   * Primary trend
   * 25
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
   * Local trend
   * 20
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
   * Trend strength
   * 10
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
   * Execution trend
   * 10
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
   * Slope agreement
   * 10
   */

  if (
    side === 1 &&
    context.h1.slope20 >
      0 &&
    context.m15.slope20 >
      0
  ) {

    score +=
      10;

  }


  if (
    side === -1 &&
    context.h1.slope20 <
      0 &&
    context.m15.slope20 <
      0
  ) {

    score +=
      10;

  }


  return score;

}


/* ================================================================
   CONTINUATION
================================================================ */

function continuationPass(
  current,
  previous,
  side,
  settings
) {

  const body =
    bodyRatio(
      current
    );


  if (
    body <
    settings.minBody
  ) {

    return false;

  }


  if (
    side === 1
  ) {

    const strictBreak =
      current.close >
      previous.high;


    const strongContinuation =
      current.close >
        previous.close &&
      current.close >
        current.open &&
      current.close >
        current.ema20 &&
      body >=
        settings.strongBody;


    return (
      strictBreak ||
      strongContinuation
    );

  }


  const strictBreak =
    current.close <
    previous.low;


  const strongContinuation =
    current.close <
      previous.close &&
    current.close <
      current.open &&
    current.close <
      current.ema20 &&
    body >=
      settings.strongBody;


  return (
    strictBreak ||
    strongContinuation
  );

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
    index < 10
  ) {

    return null;

  }


  const context =
    getContext(
      data,
      index
    );


  if (
    !validContext(
      context
    )
  ) {

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


  /* ============================================================
     LONG
  ============================================================ */

  if (
    h4Bull(
      context.h4
    ) &&
    h1Bull(
      context.h1
    ) &&
    m15Bull(
      context.m15
    )
  ) {

    const score =
      setupScore(
        context,
        1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        1,
        settings
      );


    const rsiOkay =
      current.rsi14 >=
        settings.longRsiMin &&
      current.rsi14 <=
        settings.longRsiMax;


    const continuation =
      continuationPass(

        current,

        previous,

        1,

        settings

      );


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
      rsiOkay &&
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

  if (
    h4Bear(
      context.h4
    ) &&
    h1Bear(
      context.h1
    ) &&
    m15Bear(
      context.m15
    )
  ) {

    const score =
      setupScore(
        context,
        -1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        -1,
        settings
      );


    const rsiOkay =
      current.rsi14 >=
        settings.shortRsiMin &&
      current.rsi14 <=
        settings.shortRsiMax;


    const continuation =
      continuationPass(

        current,

        previous,

        -1,

        settings

      );


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
      rsiOkay &&
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


  if (
    !Number.isFinite(
      signal.atr14
    )
  ) {

    return null;

  }


  const atrValue =
    signal.atr14;


  const start =
    Math.max(
      0,
      signalIndex -
      settings.swingLookback +
      1
    );


  /* ============================================================
     BUY
  ============================================================ */

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


  /* ============================================================
     SELL
  ============================================================ */

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
    signalIndex +
    1;


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


  const finalIndex =
    Math.min(

      data.m5.length -
      1,

      entryIndex +
      settings.maxHoldBars

    );


  let exitIndex =
    finalIndex;


  let exitPrice =
    data.m5[
      finalIndex
    ].close;


  let result =
    "TIME";


  let rawR =
    null;


  for (
    let i = entryIndex;
    i <= finalIndex;
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
       * Conservative ordering.
       *
       * If both are reached within
       * one M5 candle, assume SL first.
       */

      if (
        stopHit
      ) {

        exitIndex =
          i;


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


      if (
        targetHit
      ) {

        exitIndex =
          i;


        exitPrice =
          target;


        rawR =
          settings.targetR;


        result =
          "TP";


        break;

      }


      /*
       * Breakeven becomes active
       * for subsequent candles.
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
        stopHit
      ) {

        exitIndex =
          i;


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


      if (
        targetHit
      ) {

        exitIndex =
          i;


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
   * Time-based close.
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
  settings,
  includeCurve = true
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


  let peak =
    equity;


  let maxDrawdown =
    0;


  const equityCurve =
    includeCurve
      ? [
          {
            trade: 0,

            equity:
              round(
                equity,
                2
              )
          }
        ]
      : [];


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


    /*
     * Trade classifications.
     */

    if (
      trade.result ===
      "BE"
    ) {

      breakevens++;

    } else if (
      r > 0
    ) {

      wins++;

    } else {

      losses++;

    }


    /*
     * PF includes all real costs.
     *
     * Therefore a BE trade with
     * -0.04R cost still contributes
     * to gross loss.
     */

    if (
      r > 0
    ) {

      grossProfitR +=
        r;

    } else if (
      r < 0
    ) {

      grossLossR +=
        Math.abs(r);

    }


    /*
     * Fixed fractional equity.
     */

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


    const drawdown =
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


    maxDrawdown =
      Math.max(
        maxDrawdown,
        drawdown
      );


    if (
      includeCurve
    ) {

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

  }


  const count =
    trades.length;


  const winRate =
    count > 0
      ? (
          wins /
          count
        ) *
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
    settings.initialBalance > 0
      ? (
          (
            equity -
            settings.initialBalance
          ) /
          settings.initialBalance
        ) *
        100
      : 0;


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

    equityCurve

  };

}


/* ================================================================
   SUMMARY WITHOUT CURVE
================================================================ */

function compactMetrics(
  metrics
) {

  return {

    trades:
      metrics.trades,

    wins:
      metrics.wins,

    losses:
      metrics.losses,

    breakevens:
      metrics.breakevens,

    winRate:
      metrics.winRate,

    profitFactor:
      metrics.profitFactor,

    expectancyR:
      metrics.expectancyR,

    totalR:
      metrics.totalR,

    maxDrawdown:
      metrics.maxDrawdown

  };

}


/* ================================================================
   STRATEGY GRADE
================================================================ */

function gradeStrategy(
  overall,
  validation,
  direction
) {

  /*
   * Small total sample.
   */

  if (
    overall.trades <
    30
  ) {

    return {

      grade:
        "N/A",

      verdict:
        "Not enough total trades yet"

    };

  }


  /*
   * Validation too small.
   */

  if (
    validation.trades <
    8
  ) {

    return {

      grade:
        "P",

      verdict:
        "Promising, but holdout sample is still too small"

    };

  }


  /*
   * One-sided regime warning.
   */

  const oneSided =
    direction.long.trades === 0 ||
    direction.short.trades === 0;


  if (
    overall.trades >= 60 &&
    validation.trades >= 15 &&
    overall.profitFactor >=
      1.40 &&
    overall.expectancyR >=
      0.15 &&
    validation.profitFactor >=
      1.15 &&
    validation.expectancyR >
      0 &&
    overall.maxDrawdown <=
      12 &&
    !oneSided
  ) {

    return {

      grade:
        "A",

      verdict:
        "Strong historical result across both directions"

    };

  }


  if (
    overall.trades >= 40 &&
    validation.trades >= 10 &&
    overall.profitFactor >=
      1.20 &&
    overall.expectancyR >=
      0.08 &&
    validation.expectancyR >=
      0 &&
    overall.maxDrawdown <=
      16
  ) {

    return {

      grade:
        "B",

      verdict:
        oneSided
          ? "Positive edge, but still concentrated in one market regime"
          : "Promising historical edge"

    };

  }


  if (
    overall.profitFactor >
      1.05 &&
    overall.expectancyR >
      0
  ) {

    return {

      grade:
        "C",

      verdict:
        "Positive overall, but robustness is not yet proven"

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
   DEVELOPMENT SELECTION SCORE
================================================================ */

/*
 * CRITICAL:
 *
 * This score is calculated ONLY
 * from development data.
 *
 * Validation data is completely ignored
 * when selecting the best mode.
 */

function developmentSelectionScore(
  metrics
) {

  if (
    metrics.trades <
    10
  ) {

    return (
      -100 +
      metrics.trades
    );

  }


  return (

    metrics.expectancyR *
      32

    +

    Math.min(
      metrics.profitFactor,
      3
    ) *
      9

    +

    Math.min(
      metrics.trades,
      120
    ) *
      0.12

    -

    metrics.maxDrawdown *
      1.35

  );

}


/* ================================================================
   RUN ONE MODE
================================================================ */

function runMode(
  data,
  startIndex,
  settings
) {

  const trades = [];


  let index =
    startIndex;


  while (
    index <
    data.m5.length -
    1
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


  const startTime =
    data.m5[
      startIndex
    ].ts;


  const endTime =
    data.m5[
      data.m5.length -
      1
    ].closeTs;


  const splitTime =
    startTime +
    (
      endTime -
      startTime
    ) *
    0.70;


  const developmentTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) <
        splitTime
    );


  const validationTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) >=
        splitTime
    );


  const longTrades =
    trades.filter(
      trade =>
        trade.side ===
        "BUY"
    );


  const shortTrades =
    trades.filter(
      trade =>
        trade.side ===
        "SELL"
    );


  const overall =
    calculateMetrics(
      trades,
      settings,
      true
    );


  const development =
    calculateMetrics(
      developmentTrades,
      settings,
      false
    );


  const validation =
    calculateMetrics(
      validationTrades,
      settings,
      false
    );


  const direction = {

    long:
      compactMetrics(

        calculateMetrics(
          longTrades,
          settings,
          false
        )

      ),

    short:
      compactMetrics(

        calculateMetrics(
          shortTrades,
          settings,
          false
        )

      )

  };


  const grade =
    gradeStrategy(
      overall,
      validation,
      direction
    );


  return {

    mode:
      settings.mode,

    settings,

    splitTime:
      new Date(
        splitTime
      ).toISOString(),

    selectionScore:
      round(

        developmentSelectionScore(
          development
        ),

        3

      ),

    metrics: {

      ...overall,

      grade:
        grade.grade,

      verdict:
        grade.verdict

    },

    development,

    validation,

    direction,

    trades

  };

}


/* ================================================================
   STRATEGY MODES
================================================================ */

function presets(
  base
) {

  return [

    /* ============================================================
       STRICT
    ============================================================ */

    {

      ...base,

      mode:
        "STRICT",

      minScore:
        80,

      minADX:
        18,

      pullbackBars:
        5,

      pullbackToleranceATR:
        0.18,

      maxPullbackDepthATR:
        0.50,

      minBody:
        0.45,

      strongBody:
        0.55,

      maxChaseATR:
        0.75,

      longRsiMin:
        48,

      longRsiMax:
        68,

      shortRsiMin:
        32,

      shortRsiMax:
        52,

      cooldownBars:
        3

    },


    /* ============================================================
       BALANCED

       IMPORTANT:
       This keeps the V1.2 rules that
       produced the current 35-trade result.
    ============================================================ */

    {

      ...base,

      mode:
        "BALANCED",

      minScore:
        68,

      minADX:
        14,

      pullbackBars:
        8,

      pullbackToleranceATR:
        0.28,

      maxPullbackDepthATR:
        0.75,

      minBody:
        0.30,

      strongBody:
        0.42,

      maxChaseATR:
        1.10,

      longRsiMin:
        44,

      longRsiMax:
        72,

      shortRsiMin:
        28,

      shortRsiMax:
        56,

      cooldownBars:
        1

    },


    /* ============================================================
       ACTIVE
    ============================================================ */

    {

      ...base,

      mode:
        "ACTIVE",

      minScore:
        60,

      minADX:
        12,

      pullbackBars:
        10,

      pullbackToleranceATR:
        0.35,

      maxPullbackDepthATR:
        0.95,

      minBody:
        0.22,

      strongBody:
        0.34,

      maxChaseATR:
        1.35,

      longRsiMin:
        40,

      longRsiMax:
        76,

      shortRsiMin:
        24,

      shortRsiMax:
        60,

      cooldownBars:
        0

    }

  ];

}


/* ================================================================
   CURRENT TIMEFRAME STATE
================================================================ */

function timeframeState(
  candle,
  type
) {

  let direction =
    "MIXED";


  if (
    type === "H4"
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
    type === "H1"
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
    type === "M15"
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
    type === "M5"
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


/* ================================================================
   LATEST MARKET STATE
================================================================ */

function latestState(
  data,
  modeSettings
) {

  const index =
    data.m5.length -
    1;


  const context =
    getContext(
      data,
      index
    );


  if (
    !validContext(
      context
    )
  ) {

    return null;

  }


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


  const liveModes =
    [];


  for (
    const settings of
    modeSettings
  ) {

    const signal =
      getSignal(
        data,
        index,
        settings
      );


    liveModes.push({

      mode:
        settings.mode,

      signal:
        signal
          ? (
              signal.side === 1
                ? "BUY"
                : "SELL"
            )
          : "WAIT",

      score:
        signal
          ? signal.score
          : null

    });

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

    liveModes,

    timeframes: {

      m5:
        timeframeState(
          context.m5,
          "M5"
        ),

      m15:
        timeframeState(
          context.m15,
          "M15"
        ),

      h1:
        timeframeState(
          context.h1,
          "H1"
        ),

      h4:
        timeframeState(
          context.h4,
          "H4"
        )

    }

  };

}


/* ================================================================
   CACHE
================================================================ */

let CACHE = {

  targetBars: null,

  expires: 0,

  data: null

};


/* ================================================================
   LOAD DATA
================================================================ */

async function loadData(
  targetBars
) {

  if (
    CACHE.data &&
    CACHE.targetBars ===
      targetBars &&
    CACHE.expires >
      Date.now()
  ) {

    return CACHE.data;

  }


  const rawM5 =
    await fetchM5History(
      targetBars
    );


  if (
    rawM5.length <
    1000
  ) {

    throw new Error(
      `Only ${rawM5.length} M5 candles were returned.`
    );

  }


  const data =
    buildData(
      rawM5
    );


  CACHE = {

    targetBars,

    expires:
      Date.now() +
      60000,

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
    "no-store, no-cache, must-revalidate"
  );


  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
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
          "GET requests only."

      });

  }


  if (!TD_KEY) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing TWELVE_DATA_API_KEY_4."

      });

  }


  try {

    const q =
      req.query || {};


    /* ============================================================
       USER / BASE SETTINGS
    ============================================================ */

    const requestedTestBars =
      integerParam(
        q.bars,
        9000,
        3000,
        15000
      );


    const targetR =
      numberParam(
        q.targetR,
        1.8,
        0.5,
        5
      );


    const riskPct =
      numberParam(
        q.riskPct,
        0.5,
        0.01,
        5
      );


    const costR =
      numberParam(
        q.costR,
        0.04,
        0,
        0.5
      );


    const useBreakeven =
      boolParam(
        q.useBreakeven,
        true
      );


    const breakevenR =
      numberParam(
        q.breakevenR,
        1.0,
        0.25,
        3
      );


    const sessionStart =
      integerParam(
        q.sessionStart,
        5,
        0,
        23
      );


    const sessionEnd =
      integerParam(
        q.sessionEnd,
        19,
        0,
        23
      );


    const useSession =
      boolParam(
        q.useSession,
        true
      );


    const initialBalance =
      numberParam(
        q.initialBalance,
        10000,
        100,
        100000000
      );


    const targetHistoryBars =
      Math.min(

        requestedTestBars +
        WARMUP_M5_BARS,

        CHUNK_SIZE *
        MAX_CHUNKS

      );


    /* ============================================================
       LOAD HISTORY
    ============================================================ */

    const data =
      await loadData(
        targetHistoryBars
      );


    const validStart =
      firstValidIndex(
        data
      );


    if (
      validStart <
      0
    ) {

      throw new Error(
        "Could not build enough H4 history for EMA200."
      );

    }


    /*
     * Test only the requested latest bars,
     * while preserving the earlier candles
     * for indicator warm-up.
     */

    const startIndex =
      Math.max(

        validStart,

        data.m5.length -
        requestedTestBars

      );


    if (
      startIndex >=
      data.m5.length -
      50
    ) {

      throw new Error(
        "Not enough valid evaluation history after EMA warm-up."
      );

    }


    const base = {

      testBars:
        data.m5.length -
        startIndex,

      targetR,

      useBreakeven,

      breakevenR,

      swingLookback:
        6,

      structureBufferATR:
        0.15,

      minStopATR:
        0.80,

      maxStopATR:
        2.0,

      maxHoldBars:
        48,

      minAtrPct:
        0.015,

      useSession,

      sessionStart,

      sessionEnd,

      initialBalance,

      riskPct,

      costR

    };


    const modeSettings =
      presets(
        base
      );


    /* ============================================================
       RUN EACH MODE
    ============================================================ */

    const results =
      modeSettings.map(
        settings =>
          runMode(

            data,

            startIndex,

            settings

          )
      );


    /*
     * BEST MODE IS CHOSEN USING
     * DEVELOPMENT ONLY.
     */

    const ranked =
      [
        ...results
      ]
        .sort(
          (
            a,
            b
          ) =>
            b.selectionScore -
            a.selectionScore
        );


    const best =
      ranked[0];


    /* ============================================================
       LIVE STATE
    ============================================================ */

    const latest =
      latestState(
        data,
        modeSettings
      );


    const periodStart =
      data.m5[
        startIndex
      ];


    const periodEnd =
      data.m5[
        data.m5.length -
        1
      ];


    /* ============================================================
       REGIME WARNING
    ============================================================ */

    let regimeCoverage =
      "MIXED";


    if (
      best.metrics.buys === 0 &&
      best.metrics.sells > 0
    ) {

      regimeCoverage =
        "SHORT-ONLY SAMPLE";

    }


    if (
      best.metrics.sells === 0 &&
      best.metrics.buys > 0
    ) {

      regimeCoverage =
        "LONG-ONLY SAMPLE";

    }


    if (
      best.metrics.buys > 0 &&
      best.metrics.sells > 0
    ) {

      regimeCoverage =
        "BOTH DIRECTIONS TESTED";

    }


    return res
      .status(200)
      .json({

        ok: true,

        strategy:
          "TYSON TREND PULLBACK V1.3",

        symbol:
          SYMBOL,

        provider:
          "Twelve Data",

        dataArchitecture:
          "M5 source with locally aggregated M15/H1/H4",

        selectionMethod:
          "Best mode selected using first 70% only",

        requestedTestBars,

        downloadedM5Bars:
          data.m5.length,

        evaluatedM5Bars:
          data.m5.length -
          startIndex,

        period: {

          start:
            new Date(
              periodStart.ts
            ).toISOString(),

          end:
            new Date(
              periodEnd.closeTs
            ).toISOString()

        },

        bestMode:
          best.mode,

        regimeCoverage,

        best: {

          mode:
            best.mode,

          selectionScore:
            best.selectionScore,

          splitTime:
            best.splitTime,

          metrics:
            best.metrics,

          development:
            best.development,

          validation:
            best.validation,

          direction:
            best.direction

        },

        modes:
          ranked.map(
            result => ({

              mode:
                result.mode,

              selectionScore:
                result.selectionScore,

              splitTime:
                result.splitTime,

              metrics:
                compactMetrics(
                  result.metrics
                ),

              grade:
                result.metrics.grade,

              verdict:
                result.metrics.verdict,

              development:
                compactMetrics(
                  result.development
                ),

              validation:
                compactMetrics(
                  result.validation
                ),

              direction:
                result.direction

            })
          ),

        latest,

        trades:
          best.trades
            .slice(-400)
            .reverse(),

        assumptions: [

          "Only completed M5 candles are downloaded.",

          "M15, H1 and H4 are created locally from the same M5 feed.",

          "Higher-timeframe candles cannot be used until their scheduled close time.",

          "Signals enter on the next M5 candle open.",

          "Stop loss wins same-bar TP/SL collisions for conservative testing.",

          "Breakeven becomes active only for subsequent bars.",

          "Trading cost is deducted in R from every trade.",

          "The best strategy mode is chosen using development data only.",

          "Validation data does not influence strategy selection.",

          "Historical performance is not a guarantee of future performance."

        ]

      });


  } catch (
    error
  ) {

    console.error(
      "V1.3 BACKTEST ERROR:",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        error:
          error?.message ||
          "Backtest failed."

      });

  }

}