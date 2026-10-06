/* ================================================================
   MKAYFX GOLD LIQUIDITY BACKTESTER V1
   ---------------------------------------------------------------
   FILE:
   /api/backtest.js

   DATA
   ---------------------------------------------------------------
   TWELVE_DATA_API_KEY_4

   SYMBOL
   XAU/USD

   EXECUTION
   M5

   STRATEGY
   ---------------------------------------------------------------
   1. Build liquidity using ONLY historical information available
      before / on the current candle.
   2. Detect:
      - Previous Day High / Low
      - Session High / Low
      - Swing High / Low
      - Equal High / Low
      - Liquidity clustering
   3. Score each pool.
   4. Find dominant attacked liquidity.
   5. Require minimum RAID SCORE.
   6. Require sweep + rejection.
   7. Enter NEXT M5 open.
   8. SL outside swept liquidity.
   9. TP = configurable R multiple.

   IMPORTANT
   ---------------------------------------------------------------
   This is a strategy research/backtest model.
   Scores are heuristic and not guaranteed probabilities.
================================================================ */


/* ================================================================
   CONFIG
================================================================ */

const TD_BASE =
  "https://api.twelvedata.com";

const API_KEY =
  process.env.TWELVE_DATA_API_KEY_4 || "";

const SYMBOL =
  "XAU/USD";

const INTERVAL =
  "5min";

const MAX_OUTPUTSIZE =
  5000;


/* ================================================================
   CACHE
================================================================ */

let candleCache = {
  time: 0,
  candles: null
};

const CACHE_MS =
  10 * 60 * 1000;


/* ================================================================
   HELPERS
================================================================ */

function finite(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;
  }


  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )
    ? n
    : null;
}


function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      Number(
        value
      ) || 0
    )
  );
}


function round(
  value,
  decimals = 2
) {

  const n =
    finite(
      value
    );


  if (
    n === null
  ) {

    return null;
  }


  const p =
    10 **
    decimals;


  return (
    Math.round(
      n *
      p
    ) /
    p
  );
}


function mean(
  values
) {

  const clean =
    values.filter(
      Number.isFinite
    );


  if (
    !clean.length
  ) {

    return 0;
  }


  return (
    clean.reduce(
      (
        sum,
        value
      ) =>
        sum +
        value,
      0
    ) /
    clean.length
  );
}


function last(
  array
) {

  return array?.length
    ? array[
        array.length -
        1
      ]
    : null;
}


function unique(
  values
) {

  return [
    ...new Set(
      values
    )
  ];
}


function isoDay(
  timestamp
) {

  return new Date(
    timestamp
  )
    .toISOString()
    .slice(
      0,
      10
    );
}


function utcHour(
  timestamp
) {

  return new Date(
    timestamp
  )
    .getUTCHours();
}


/* ================================================================
   PARSE TWELVE DATA
================================================================ */

function parseTimestamp(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;
  }


  if (
    typeof value ===
    "number"
  ) {

    return value <
      100000000000
      ? value *
        1000
      : value;
  }


  let text =
    String(
      value
    );


  if (
    !text.includes(
      "T"
    ) &&
    text.includes(
      " "
    )
  ) {

    text =
      text.replace(
        " ",
        "T"
      );
  }


  if (
    !/[zZ]|[+-]\d\d:\d\d$/.test(
      text
    )
  ) {

    text +=
      "Z";
  }


  const parsed =
    Date.parse(
      text
    );


  return Number.isFinite(
    parsed
  )
    ? parsed
    : null;
}


function parseValues(
  json
) {

  if (
    !json ||
    !Array.isArray(
      json.values
    )
  ) {

    throw new Error(
      json?.message ||
      "Twelve Data returned no candle values."
    );
  }


  return json.values

    .map(
      row => {

        const time =
          parseTimestamp(
            row.datetime
          );


        const open =
          finite(
            row.open
          );


        const high =
          finite(
            row.high
          );


        const low =
          finite(
            row.low
          );


        const close =
          finite(
            row.close
          );


        if (
          time === null ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ) {

          return null;
        }


        if (
          open <= 0 ||
          high <= 0 ||
          low <= 0 ||
          close <= 0
        ) {

          return null;
        }


        return {

          time,

          open,

          high,

          low,

          close,

          volume:
            finite(
              row.volume
            ) || 0

        };

      }
    )

    .filter(
      Boolean
    )

    .sort(
      (
        a,
        b
      ) =>
        a.time -
        b.time
    );
}


/* ================================================================
   FETCH DATA
================================================================ */

async function fetchHistoricalCandles(
  force = false
) {

  if (
    !force &&
    candleCache.candles &&
    Date.now() -
    candleCache.time <
    CACHE_MS
  ) {

    return candleCache.candles;
  }


  if (
    !API_KEY
  ) {

    throw new Error(
      "TWELVE_DATA_API_KEY_4 is missing."
    );
  }


  const url =

    `${TD_BASE}/time_series` +

    `?symbol=${encodeURIComponent(
      SYMBOL
    )}` +

    `&interval=${INTERVAL}` +

    `&outputsize=${MAX_OUTPUTSIZE}` +

    `&order=asc` +

    `&timezone=UTC` +

    `&apikey=${encodeURIComponent(
      API_KEY
    )}`;


  const response =
    await fetch(
      url,
      {
        headers: {

          "User-Agent":
            "MKAYFX-LIQUIDITY-BACKTEST-V1"

        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Twelve Data HTTP ${response.status}`
    );
  }


  const json =
    await response.json();


  if (
    json.status ===
    "error"
  ) {

    throw new Error(
      json.message ||
      "Twelve Data error."
    );
  }


  const candles =
    parseValues(
      json
    );


  candleCache = {

    time:
      Date.now(),

    candles

  };


  return candles;
}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  period
) {

  if (
    !values.length
  ) {

    return [];
  }


  const multiplier =
    2 /
    (
      period +
      1
    );


  let current =
    values[0];


  const output =
    [];


  for (
    let i = 0;
    i <
      values.length;
    i++
  ) {

    if (
      i === 0
    ) {

      current =
        values[i];

    } else {

      current =
        values[i] *
        multiplier +
        current *
        (
          1 -
          multiplier
        );

    }


    output.push(
      current
    );

  }


  return output;
}


/* ================================================================
   ATR
================================================================ */

function atrSeries(
  candles,
  period = 14
) {

  if (
    candles.length <
    2
  ) {

    return [];
  }


  const ranges = [
    candles[0].high -
    candles[0].low
  ];


  for (
    let i = 1;
    i <
      candles.length;
    i++
  ) {

    const current =
      candles[i];


    const previous =
      candles[i - 1];


    ranges.push(

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

      )

    );

  }


  return ema(
    ranges,
    period
  );
}


function atr(
  candles,
  period = 14
) {

  const values =
    atrSeries(
      candles,
      period
    );


  return values.length
    ? last(
        values
      )
    : 0;
}


/* ================================================================
   RESAMPLING
================================================================ */

function resample(
  candles,
  minutes
) {

  const ms =
    minutes *
    60 *
    1000;


  const map =
    new Map();


  for (
    const candle
    of candles
  ) {

    const bucket =
      Math.floor(
        candle.time /
        ms
      ) *
      ms;


    if (
      !map.has(
        bucket
      )
    ) {

      map.set(
        bucket,
        {

          time:
            bucket,

          open:
            candle.open,

          high:
            candle.high,

          low:
            candle.low,

          close:
            candle.close,

          volume:
            candle.volume || 0

        }
      );

    } else {

      const target =
        map.get(
          bucket
        );


      target.high =
        Math.max(
          target.high,
          candle.high
        );


      target.low =
        Math.min(
          target.low,
          candle.low
        );


      target.close =
        candle.close;


      target.volume +=
        candle.volume || 0;

    }

  }


  return [
    ...map.values()
  ]
    .sort(
      (
        a,
        b
      ) =>
        a.time -
        b.time
    );
}


/* ================================================================
   PIVOTS
================================================================ */

function pivotHigh(
  candles,
  index,
  leftCount = 3,
  rightCount = 3
) {

  if (
    index <
    leftCount ||
    index +
    rightCount >=
    candles.length
  ) {

    return false;
  }


  const level =
    candles[index].high;


  for (
    let i =
      index -
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ) {

    if (
      i === index
    ) {

      continue;
    }


    if (
      candles[i].high >=
      level
    ) {

      return false;
    }

  }


  return true;
}


function pivotLow(
  candles,
  index,
  leftCount = 3,
  rightCount = 3
) {

  if (
    index <
    leftCount ||
    index +
    rightCount >=
    candles.length
  ) {

    return false;
  }


  const level =
    candles[index].low;


  for (
    let i =
      index -
      leftCount;

    i <=
      index +
      rightCount;

    i++
  ) {

    if (
      i === index
    ) {

      continue;
    }


    if (
      candles[i].low <=
      level
    ) {

      return false;
    }

  }


  return true;
}


/* ================================================================
   SWINGS
================================================================ */

function swings(
  candles,
  lookback = 180
) {

  const data =
    candles.slice(
      -lookback
    );


  const highs =
    [];


  const lows =
    [];


  for (
    let i = 3;
    i <
      data.length -
      3;
    i++
  ) {

    if (
      pivotHigh(
        data,
        i
      )
    ) {

      highs.push({

        time:
          data[i].time,

        price:
          data[i].high

      });

    }


    if (
      pivotLow(
        data,
        i
      )
    ) {

      lows.push({

        time:
          data[i].time,

        price:
          data[i].low

      });

    }

  }


  return {

    highs,

    lows

  };
}


/* ================================================================
   STRUCTURE
================================================================ */

function structure(
  candles
) {

  if (
    candles.length <
    55
  ) {

    return {

      bias:
        "NEUTRAL",

      score:
        0

    };
  }


  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const e20 =
    last(
      ema(
        closes,
        20
      )
    );


  const e50 =
    last(
      ema(
        closes,
        50
      )
    );


  const price =
    last(
      candles
    ).close;


  let score =
    0;


  if (
    price >
    e20
  ) {

    score++;

  } else {

    score--;

  }


  if (
    e20 >
    e50
  ) {

    score++;

  } else {

    score--;

  }


  const recent =
    candles.slice(
      -10
    );


  const older =
    candles.slice(
      -20,
      -10
    );


  const recentHigh =
    Math.max(
      ...recent.map(
        candle =>
          candle.high
      )
    );


  const oldHigh =
    Math.max(
      ...older.map(
        candle =>
          candle.high
      )
    );


  const recentLow =
    Math.min(
      ...recent.map(
        candle =>
          candle.low
      )
    );


  const oldLow =
    Math.min(
      ...older.map(
        candle =>
          candle.low
      )
    );


  if (
    recentHigh >
    oldHigh &&
    recentLow >
    oldLow
  ) {

    score +=
      2;

  }


  if (
    recentHigh <
    oldHigh &&
    recentLow <
    oldLow
  ) {

    score -=
      2;

  }


  return {

    score,

    bias:
      score >=
      2
        ? "BULLISH"
        : score <=
          -2
          ? "BEARISH"
          : "NEUTRAL"

  };
}


/* ================================================================
   PREVIOUS DAY
================================================================ */

function previousDayLevels(
  candles
) {

  if (
    candles.length <
    2
  ) {

    return null;
  }


  const currentDay =
    isoDay(
      last(
        candles
      ).time
    );


  const previousCandles =
    candles.filter(
      candle =>
        isoDay(
          candle.time
        ) <
        currentDay
    );


  if (
    !previousCandles.length
  ) {

    return null;
  }


  const previousDay =
    isoDay(
      last(
        previousCandles
      ).time
    );


  const data =
    previousCandles.filter(
      candle =>
        isoDay(
          candle.time
        ) ===
        previousDay
    );


  if (
    !data.length
  ) {

    return null;
  }


  return {

    day:
      previousDay,

    high:
      Math.max(
        ...data.map(
          candle =>
            candle.high
        )
      ),

    low:
      Math.min(
        ...data.map(
          candle =>
            candle.low
        )
      )

  };
}


/* ================================================================
   SESSION LEVELS
================================================================ */

function sessionLevels(
  candles
) {

  if (
    !candles.length
  ) {

    return {};
  }


  const day =
    isoDay(
      last(
        candles
      ).time
    );


  const currentTime =
    last(
      candles
    ).time;


  const definitions = {

    ASIA: {
      start: 0,
      end: 7
    },

    LONDON: {
      start: 7,
      end: 16
    },

    NEW_YORK: {
      start: 12,
      end: 21
    }

  };


  const result =
    {};


  for (
    const [
      name,
      definition
    ]
    of Object.entries(
      definitions
    )
  ) {

    const data =
      candles.filter(
        candle => {

          if (
            candle.time >
            currentTime
          ) {

            return false;
          }


          if (
            isoDay(
              candle.time
            ) !==
            day
          ) {

            return false;
          }


          const hour =
            utcHour(
              candle.time
            );


          return (
            hour >=
            definition.start &&
            hour <
            definition.end
          );

        }
      );


    if (
      !data.length
    ) {

      result[name] =
        null;


      continue;
    }


    result[name] = {

      high:
        Math.max(
          ...data.map(
            candle =>
              candle.high
          )
        ),

      low:
        Math.min(
          ...data.map(
            candle =>
              candle.low
          )
        )

    };

  }


  return result;
}


/* ================================================================
   EQUAL LEVELS
================================================================ */

function equalLevels(
  candles,
  atrValue
) {

  const swingData =
    swings(
      candles,
      150
    );


  const tolerance =
    Math.max(
      atrValue *
      0.15,
      0.05
    );


  const highs =
    [];


  const lows =
    [];


  const recentHighs =
    swingData.highs.slice(
      -15
    );


  const recentLows =
    swingData.lows.slice(
      -15
    );


  for (
    let i = 0;
    i <
      recentHighs.length;
    i++
  ) {

    for (
      let j =
        i + 1;

      j <
        recentHighs.length;

      j++
    ) {

      if (
        Math.abs(
          recentHighs[i].price -
          recentHighs[j].price
        ) <=
        tolerance
      ) {

        highs.push(
          (
            recentHighs[i].price +
            recentHighs[j].price
          ) /
          2
        );

      }

    }

  }


  for (
    let i = 0;
    i <
      recentLows.length;
    i++
  ) {

    for (
      let j =
        i + 1;

      j <
        recentLows.length;

      j++
    ) {

      if (
        Math.abs(
          recentLows[i].price -
          recentLows[j].price
        ) <=
        tolerance
      ) {

        lows.push(
          (
            recentLows[i].price +
            recentLows[j].price
          ) /
          2
        );

      }

    }

  }


  return {

    highs:
      highs.slice(
        -5
      ),

    lows:
      lows.slice(
        -5
      )

  };
}


/* ================================================================
   RAW LIQUIDITY
================================================================ */

function buildRawLevels(
  history,
  atrValue
) {

  const levels =
    [];


  function add(
    name,
    level,
    side,
    strength,
    type
  ) {

    if (
      !Number.isFinite(
        level
      ) ||
      level <= 0
    ) {

      return;
    }


    levels.push({

      name,

      level,

      side,

      strength,

      type

    });

  }


  const sessions =
    sessionLevels(
      history
    );


  if (
    sessions.ASIA
  ) {

    add(
      "ASIA HIGH",
      sessions.ASIA.high,
      "BUY_SIDE",
      68,
      "SESSION"
    );


    add(
      "ASIA LOW",
      sessions.ASIA.low,
      "SELL_SIDE",
      68,
      "SESSION"
    );

  }


  if (
    sessions.LONDON
  ) {

    add(
      "LONDON HIGH",
      sessions.LONDON.high,
      "BUY_SIDE",
      80,
      "SESSION"
    );


    add(
      "LONDON LOW",
      sessions.LONDON.low,
      "SELL_SIDE",
      80,
      "SESSION"
    );

  }


  if (
    sessions.NEW_YORK
  ) {

    add(
      "NEW YORK HIGH",
      sessions.NEW_YORK.high,
      "BUY_SIDE",
      84,
      "SESSION"
    );


    add(
      "NEW YORK LOW",
      sessions.NEW_YORK.low,
      "SELL_SIDE",
      84,
      "SESSION"
    );

  }


  const previousDay =
    previousDayLevels(
      history
    );


  if (
    previousDay
  ) {

    add(
      "PREVIOUS DAY HIGH",
      previousDay.high,
      "BUY_SIDE",
      90,
      "DAILY"
    );


    add(
      "PREVIOUS DAY LOW",
      previousDay.low,
      "SELL_SIDE",
      90,
      "DAILY"
    );

  }


  const h1 =
    resample(
      history,
      60
    );


  const h1Swings =
    swings(
      h1,
      120
    );


  for (
    const item
    of h1Swings.highs.slice(
      -4
    )
  ) {

    add(
      "H1 SWING HIGH",
      item.price,
      "BUY_SIDE",
      76,
      "H1_SWING"
    );

  }


  for (
    const item
    of h1Swings.lows.slice(
      -4
    )
  ) {

    add(
      "H1 SWING LOW",
      item.price,
      "SELL_SIDE",
      76,
      "H1_SWING"
    );

  }


  const equal =
    equalLevels(
      history,
      atrValue
    );


  for (
    const level
    of equal.highs
  ) {

    add(
      "EQUAL HIGHS",
      level,
      "BUY_SIDE",
      88,
      "EQUAL_LEVEL"
    );

  }


  for (
    const level
    of equal.lows
  ) {

    add(
      "EQUAL LOWS",
      level,
      "SELL_SIDE",
      88,
      "EQUAL_LEVEL"
    );

  }


  return levels;
}


/* ================================================================
   TOUCH / FRESHNESS
================================================================ */

function touchHistory({
  history,
  low,
  high,
  side,
  atrValue
}) {

  const data =
    history.slice(
      -250
    );


  let touches =
    0;


  let sweeps =
    0;


  let rejections =
    0;


  let lastTouch =
    null;


  for (
    let i = 0;
    i <
      data.length;
    i++
  ) {

    const candle =
      data[i];


    const touched =
      candle.high >=
      low &&
      candle.low <=
      high;


    if (
      touched
    ) {

      touches++;

      lastTouch =
        i;

    }


    if (
      side ===
      "BUY_SIDE"
    ) {

      if (
        candle.high >
        high
      ) {

        sweeps++;


        if (
          candle.close <
          high
        ) {

          rejections++;

        }

      }

    } else {

      if (
        candle.low <
        low
      ) {

        sweeps++;


        if (
          candle.close >
          low
        ) {

          rejections++;

        }

      }

    }

  }


  const barsSinceTouch =
    lastTouch === null
      ? data.length
      : data.length -
        1 -
        lastTouch;


  const freshness =
    clamp(

      100 -

      touches *
      12 +

      Math.min(
        barsSinceTouch,
        100
      ) *
      0.25,

      5,
      100

    );


  return {

    touches,

    sweeps,

    rejections,

    barsSinceTouch,

    freshness:
      round(
        freshness,
        1
      )

  };
}


/* ================================================================
   APPROACH
================================================================ */

function approachScore({
  history,
  side,
  atrValue
}) {

  const data =
    history.slice(
      -12
    );


  if (
    data.length <
    8
  ) {

    return 0;
  }


  const first =
    data[0].close;


  const current =
    last(
      data
    ).close;


  const move =
    current -
    first;


  const direction =
    side ===
    "BUY_SIDE"
      ? 1
      : -1;


  const directional =
    atrValue >
    0
      ? clamp(
          move *
          direction /
          atrValue *
          35,
          -100,
          100
        )
      : 0;


  let structureScore =
    0;


  for (
    let i = 1;
    i <
      data.length;
    i++
  ) {

    if (
      side ===
      "BUY_SIDE"
    ) {

      if (
        data[i].low >
        data[i - 1].low
      ) {

        structureScore++;

      }

    } else {

      if (
        data[i].high <
        data[i - 1].high
      ) {

        structureScore++;

      }

    }

  }


  structureScore =
    structureScore /
    (
      data.length -
      1
    ) *
    100;


  const olderRange =
    mean(
      data
        .slice(
          0,
          6
        )
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );


  const recentRange =
    mean(
      data
        .slice(
          -6
        )
        .map(
          candle =>
            candle.high -
            candle.low
        )
    );


  const compression =
    olderRange >
    0
      ? clamp(
          (
            1 -
            recentRange /
            olderRange
          ) *
          100,
          0,
          100
        )
      : 0;


  return clamp(

    Math.max(
      directional,
      0
    ) *
    0.50 +

    structureScore *
    0.30 +

    compression *
    0.20,

    0,
    100

  );
}


/* ================================================================
   CLUSTER LIQUIDITY
================================================================ */

function buildLiquidityZones(
  history
) {

  const price =
    last(
      history
    ).close;


  const atrValue =
    atr(
      history,
      14
    );


  if (
    !atrValue ||
    atrValue <= 0
  ) {

    return [];
  }


  const levels =
    buildRawLevels(
      history,
      atrValue
    );


  const clusterDistance =
    Math.max(
      atrValue *
      0.22,
      0.20
    );


  const clusters =
    [];


  for (
    const side
    of [
      "BUY_SIDE",
      "SELL_SIDE"
    ]
  ) {

    const sideLevels =
      levels

        .filter(
          level =>
            level.side ===
            side
        )

        .sort(
          (
            a,
            b
          ) =>
            a.level -
            b.level
        );


    let current =
      [];


    for (
      const item
      of sideLevels
    ) {

      if (
        !current.length
      ) {

        current = [
          item
        ];

        continue;
      }


      const avg =
        mean(
          current.map(
            item =>
              item.level
          )
        );


      if (
        Math.abs(
          item.level -
          avg
        ) <=
        clusterDistance
      ) {

        current.push(
          item
        );

      } else {

        clusters.push(
          current
        );


        current = [
          item
        ];

      }

    }


    if (
      current.length
    ) {

      clusters.push(
        current
      );

    }

  }


  const result =
    [];


  for (
    let i = 0;
    i <
      clusters.length;
    i++
  ) {

    const cluster =
      clusters[i];


    const side =
      cluster[0].side;


    const prices =
      cluster.map(
        item =>
          item.level
      );


    const buffer =
      atrValue *
      0.05;


    const low =
      Math.min(
        ...prices
      ) -
      buffer;


    const high =
      Math.max(
        ...prices
      ) +
      buffer;


    const center =
      (
        low +
        high
      ) /
      2;


    const distance =
      Math.abs(
        center -
        price
      );


    const distanceATR =
      distance /
      atrValue;


    /*
       Do not use liquidity that is too far away.
    */

    if (
      distanceATR >
      5
    ) {

      continue;
    }


    const proximity =
      clamp(
        100 -
        distanceATR *
        22,
        0,
        100
      );


    const density =
      clamp(
        cluster.length *
        20,
        20,
        100
      );


    const strength =
      mean(
        cluster.map(
          item =>
            item.strength
        )
      );


    const historyInfo =
      touchHistory({

        history:
          history.slice(
            0,
            -1
          ),

        low,

        high,

        side,

        atrValue

      });


    const approach =
      approachScore({

        history:
          history.slice(
            0,
            -1
          ),

        side,

        atrValue

      });


    let raidScore =
      clamp(

        strength *
        0.30 +

        density *
        0.15 +

        historyInfo.freshness *
        0.18 +

        proximity *
        0.22 +

        approach *
        0.15,

        0,
        100

      );


    /*
       Extra score when price is already aggressively attacking
       a nearby pool.
    */

    if (
      distanceATR <=
      0.35
    ) {

      raidScore +=
        5;

    }


    raidScore =
      clamp(
        raidScore,
        0,
        100
      );


    const names =
      unique(
        cluster.map(
          item =>
            item.name
        )
      );


    result.push({

      id:
        `BT-${side}-${i}`,

      name:
        cluster.length >=
        3
          ? (
              side ===
              "BUY_SIDE"
                ? "MAJOR BUY-SIDE CLUSTER"
                : "MAJOR SELL-SIDE CLUSTER"
            )
          : cluster.length ===
            2
            ? (
                side ===
                "BUY_SIDE"
                  ? "BUY-SIDE CLUSTER"
                  : "SELL-SIDE CLUSTER"
              )
            : names[0],

      side,

      price:
        center,

      low,

      high,

      distance,

      distanceATR,

      componentCount:
        cluster.length,

      components:
        cluster,

      structuralStrength:
        strength,

      density,

      freshness:
        historyInfo.freshness,

      approachScore:
        approach,

      raidScore

    });

  }


  return result.sort(
    (
      a,
      b
    ) => {

      if (
        b.raidScore !==
        a.raidScore
      ) {

        return b.raidScore -
          a.raidScore;
      }


      return a.distance -
        b.distance;

    }
  );
}


/* ================================================================
   SWEEP TEST
================================================================ */

function testSweep(
  candle,
  zone
) {

  if (
    zone.side ===
    "BUY_SIDE"
  ) {

    const penetrated =
      candle.high >
      zone.high;


    const rejected =
      penetrated &&
      candle.close <
      zone.high;


    return {

      penetrated,

      rejected,

      direction:
        "SELL",

      extreme:
        candle.high

    };

  }


  const penetrated =
    candle.low <
    zone.low;


  const rejected =
    penetrated &&
    candle.close >
    zone.low;


  return {

    penetrated,

    rejected,

    direction:
      "BUY",

    extreme:
      candle.low

  };
}


/* ================================================================
   STRUCTURE CONFIRMATION
================================================================ */

function confirmStructure(
  history,
  direction
) {

  const m15 =
    resample(
      history,
      15
    );


  const h1 =
    resample(
      history,
      60
    );


  const m5Structure =
    structure(
      history
    );


  const m15Structure =
    structure(
      m15
    );


  const h1Structure =
    structure(
      h1
    );


  const biases = [

    m5Structure.bias,

    m15Structure.bias,

    h1Structure.bias

  ];


  const wanted =
    direction ===
    "BUY"
      ? "BULLISH"
      : "BEARISH";


  const count =
    biases.filter(
      bias =>
        bias ===
        wanted
    ).length;


  return {

    confirmed:
      count >=
      1,

    count,

    biases: {

      M5:
        m5Structure.bias,

      M15:
        m15Structure.bias,

      H1:
        h1Structure.bias

    }

  };
}


/* ================================================================
   RUN BACKTEST
================================================================ */

function runBacktest(
  candles,
  config
) {

  const minScore =
    clamp(
      config.minScore,
      1,
      100
    );


  const rr =
    clamp(
      config.rr,
      0.25,
      10
    );


  const slAtr =
    clamp(
      config.slAtr,
      0.05,
      3
    );


  const requireStructure =
    Boolean(
      config.requireStructure
    );


  const oneTradeAtATime =
    Boolean(
      config.oneTradeAtATime
    );


  const maxBars =
    clamp(
      config.maxBars,
      1,
      1000
    );


  const startIndex =
    Math.max(
      300,
      candles.length -
      config.maxTestBars
    );


  const trades =
    [];


  let activeTrade =
    null;


  let equityR =
    0;


  let peakR =
    0;


  let maxDrawdownR =
    0;


  let setupsSeen =
    0;


  let scoreQualified =
    0;


  let sweepsSeen =
    0;


  let rejectedSweeps =
    0;


  let structurePassed =
    0;


  for (
    let i =
      startIndex;

    i <
      candles.length -
      1;

    i++
  ) {

    const candle =
      candles[i];


    /* ============================================================
       MANAGE ACTIVE TRADE
    ============================================================ */

    if (
      activeTrade
    ) {

      activeTrade.barsHeld++;


      const hitStop =
        activeTrade.direction ===
        "BUY"
          ? candle.low <=
            activeTrade.stop
          : candle.high >=
            activeTrade.stop;


      const hitTarget =
        activeTrade.direction ===
        "BUY"
          ? candle.high >=
            activeTrade.target
          : candle.low <=
            activeTrade.target;


      /*
         Conservative same-bar handling:
         if both TP and SL are hit, SL is assumed first.
      */

      if (
        hitStop
      ) {

        activeTrade.exitTime =
          candle.time;


        activeTrade.exitPrice =
          activeTrade.stop;


        activeTrade.result =
          "LOSS";


        activeTrade.r =
          -1;


        equityR -=
          1;


        trades.push(
          activeTrade
        );


        activeTrade =
          null;


        peakR =
          Math.max(
            peakR,
            equityR
          );


        maxDrawdownR =
          Math.max(
            maxDrawdownR,
            peakR -
            equityR
          );


        continue;

      }


      if (
        hitTarget
      ) {

        activeTrade.exitTime =
          candle.time;


        activeTrade.exitPrice =
          activeTrade.target;


        activeTrade.result =
          "WIN";


        activeTrade.r =
          rr;


        equityR +=
          rr;


        trades.push(
          activeTrade
        );


        activeTrade =
          null;


        peakR =
          Math.max(
            peakR,
            equityR
          );


        maxDrawdownR =
          Math.max(
            maxDrawdownR,
            peakR -
            equityR
          );


        continue;

      }


      if (
        activeTrade &&
        activeTrade.barsHeld >=
        maxBars
      ) {

        const exit =
          candle.close;


        const risk =
          Math.abs(
            activeTrade.entry -
            activeTrade.stop
          );


        let r;


        if (
          activeTrade.direction ===
          "BUY"
        ) {

          r =
            (
              exit -
              activeTrade.entry
            ) /
            risk;

        } else {

          r =
            (
              activeTrade.entry -
              exit
            ) /
            risk;

        }


        activeTrade.exitTime =
          candle.time;


        activeTrade.exitPrice =
          exit;


        activeTrade.result =
          r >= 0
            ? "TIME WIN"
            : "TIME LOSS";


        activeTrade.r =
          round(
            r,
            3
          );


        equityR +=
          r;


        trades.push(
          activeTrade
        );


        activeTrade =
          null;


        peakR =
          Math.max(
            peakR,
            equityR
          );


        maxDrawdownR =
          Math.max(
            maxDrawdownR,
            peakR -
            equityR
          );

      }

    }


    if (
      activeTrade &&
      oneTradeAtATime
    ) {

      continue;
    }


    /* ============================================================
       BUILD HISTORICAL MARKET STATE
    ============================================================ */

    const history =
      candles.slice(
        0,
        i +
        1
      );


    const current =
      last(
        history
      );


    if (
      history.length <
      300
    ) {

      continue;
    }


    const atrValue =
      atr(
        history,
        14
      );


    if (
      !atrValue ||
      atrValue <= 0
    ) {

      continue;
    }


    const zones =
      buildLiquidityZones(
        history
      );


    if (
      !zones.length
    ) {

      continue;
    }


    setupsSeen++;


    /*
       Only zones close enough to actually be attacked by this bar.
    */

    const attackCandidates =
      zones.filter(
        zone => {

          if (
            zone.side ===
            "BUY_SIDE"
          ) {

            return (
              current.high >=
              zone.low -
              atrValue *
              0.15
            );

          }


          return (
            current.low <=
            zone.high +
            atrValue *
            0.15
          );

        }
      );


    if (
      !attackCandidates.length
    ) {

      continue;
    }


    const zone =
      attackCandidates[0];


    if (
      zone.raidScore <
      minScore
    ) {

      continue;
    }


    scoreQualified++;


    const sweep =
      testSweep(
        current,
        zone
      );


    if (
      !sweep.penetrated
    ) {

      continue;
    }


    sweepsSeen++;


    if (
      !sweep.rejected
    ) {

      continue;
    }


    rejectedSweeps++;


    const structureConfirmation =
      confirmStructure(
        history,
        sweep.direction
      );


    if (
      requireStructure &&
      !structureConfirmation.confirmed
    ) {

      continue;
    }


    structurePassed++;


    const next =
      candles[
        i +
        1
      ];


    if (
      !next
    ) {

      continue;
    }


    const entry =
      next.open;


    let stop;


    if (
      sweep.direction ===
      "BUY"
    ) {

      stop =
        Math.min(
          sweep.extreme,
          zone.low
        ) -
        atrValue *
        slAtr;

    } else {

      stop =
        Math.max(
          sweep.extreme,
          zone.high
        ) +
        atrValue *
        slAtr;

    }


    const risk =
      Math.abs(
        entry -
        stop
      );


    /*
       Skip broken/unrealistic trades.
    */

    if (
      !Number.isFinite(
        risk
      ) ||
      risk <= 0 ||
      risk >
      atrValue *
      6
    ) {

      continue;
    }


    const target =
      sweep.direction ===
      "BUY"
        ? entry +
          risk *
          rr
        : entry -
          risk *
          rr;


    const newTrade = {

      id:
        trades.length +
        1,

      signalTime:
        current.time,

      entryTime:
        next.time,

      direction:
        sweep.direction,

      zoneName:
        zone.name,

      zoneSide:
        zone.side,

      zonePrice:
        round(
          zone.price,
          2
        ),

      raidScore:
        round(
          zone.raidScore,
          1
        ),

      density:
        round(
          zone.density,
          1
        ),

      freshness:
        round(
          zone.freshness,
          1
        ),

      approachScore:
        round(
          zone.approachScore,
          1
        ),

      structure:
        structureConfirmation.biases,

      entry:
        round(
          entry,
          2
        ),

      stop:
        round(
          stop,
          2
        ),

      target:
        round(
          target,
          2
        ),

      risk:
        round(
          risk,
          2
        ),

      rr,

      barsHeld:
        0,

      result:
        "OPEN",

      r:
        null

    };


    /*
       Entry happens on NEXT bar open.
       Start managing from next loop iteration.
    */

    activeTrade =
      newTrade;

  }


  /*
     Close any trade still open at final close.
  */

  if (
    activeTrade
  ) {

    const candle =
      last(
        candles
      );


    const risk =
      Math.abs(
        activeTrade.entry -
        activeTrade.stop
      );


    let r;


    if (
      activeTrade.direction ===
      "BUY"
    ) {

      r =
        (
          candle.close -
          activeTrade.entry
        ) /
        risk;

    } else {

      r =
        (
          activeTrade.entry -
          candle.close
        ) /
        risk;

    }


    activeTrade.exitTime =
      candle.time;


    activeTrade.exitPrice =
      candle.close;


    activeTrade.result =
      r >= 0
        ? "END WIN"
        : "END LOSS";


    activeTrade.r =
      round(
        r,
        3
      );


    equityR +=
      r;


    trades.push(
      activeTrade
    );


    peakR =
      Math.max(
        peakR,
        equityR
      );


    maxDrawdownR =
      Math.max(
        maxDrawdownR,
        peakR -
        equityR
      );

  }


  /* ============================================================
     STATISTICS
  ============================================================ */

  const wins =
    trades.filter(
      trade =>
        trade.r >
        0
    );


  const losses =
    trades.filter(
      trade =>
        trade.r <
        0
    );


  const grossProfit =
    wins.reduce(
      (
        sum,
        trade
      ) =>
        sum +
        trade.r,
      0
    );


  const grossLoss =
    Math.abs(
      losses.reduce(
        (
          sum,
          trade
        ) =>
          sum +
          trade.r,
        0
      )
    );


  const profitFactor =
    grossLoss >
    0
      ? grossProfit /
        grossLoss
      : grossProfit >
        0
        ? 999
        : 0;


  const averageR =
    trades.length
      ? trades.reduce(
          (
            sum,
            trade
          ) =>
            sum +
            trade.r,
          0
        ) /
        trades.length
      : 0;


  const buys =
    trades.filter(
      trade =>
        trade.direction ===
        "BUY"
    );


  const sells =
    trades.filter(
      trade =>
        trade.direction ===
        "SELL"
    );


  const averageBars =
    trades.length
      ? mean(
          trades.map(
            trade =>
              trade.barsHeld
          )
        )
      : 0;


  return {

    settings: {

      symbol:
        SYMBOL,

      timeframe:
        "M5",

      minRaidScore:
        minScore,

      rr,

      slAtrBuffer:
        slAtr,

      requireStructure,

      oneTradeAtATime,

      maxBarsInTrade:
        maxBars,

      testedBars:
        candles.length -
        startIndex

    },


    funnel: {

      liquidityStates:
        setupsSeen,

      raidScoreQualified:
        scoreQualified,

      penetrations:
        sweepsSeen,

      rejectedSweeps,

      structurePassed

    },


    summary: {

      trades:
        trades.length,

      wins:
        wins.length,

      losses:
        losses.length,

      winRate:
        round(
          trades.length
            ? wins.length /
              trades.length *
              100
            : 0,
          2
        ),

      netR:
        round(
          equityR,
          2
        ),

      averageR:
        round(
          averageR,
          3
        ),

      profitFactor:
        round(
          profitFactor,
          2
        ),

      maxDrawdownR:
        round(
          maxDrawdownR,
          2
        ),

      grossProfitR:
        round(
          grossProfit,
          2
        ),

      grossLossR:
        round(
          grossLoss,
          2
        ),

      averageBarsHeld:
        round(
          averageBars,
          1
        ),

      buyTrades:
        buys.length,

      sellTrades:
        sells.length,

      buyWinRate:
        round(
          buys.length
            ? buys.filter(
                trade =>
                  trade.r >
                  0
              ).length /
              buys.length *
              100
            : 0,
          2
        ),

      sellWinRate:
        round(
          sells.length
            ? sells.filter(
                trade =>
                  trade.r >
                  0
              ).length /
              sells.length *
              100
            : 0,
          2
        )

    },


    trades:
      trades.reverse()

  };
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
    "no-store, max-age=0"
  );


  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );


  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok:
          false,

        error:
          "Method not allowed."

      });

  }


  try {

    const minScore =
      finite(
        req.query?.score
      ) ??
      70;


    const rr =
      finite(
        req.query?.rr
      ) ??
      1.5;


    const slAtr =
      finite(
        req.query?.slAtr
      ) ??
      0.20;


    const maxBars =
      finite(
        req.query?.maxBars
      ) ??
      72;


    const bars =
      finite(
        req.query?.bars
      ) ??
      4000;


    const requireStructure =
      String(
        req.query?.structure ??
        "1"
      ) !==
      "0";


    const oneTradeAtATime =
      String(
        req.query?.oneTrade ??
        "1"
      ) !==
      "0";


    const force =
      String(
        req.query?.force ??
        ""
      ) ===
      "1";


    const candles =
      await fetchHistoricalCandles(
        force
      );


    if (
      candles.length <
      400
    ) {

      throw new Error(
        `Not enough historical M5 candles. Received ${candles.length}.`
      );

    }


    const result =
      runBacktest(
        candles,
        {

          minScore,

          rr,

          slAtr,

          maxBars,

          maxTestBars:
            clamp(
              bars,
              300,
              MAX_OUTPUTSIZE
            ),

          requireStructure,

          oneTradeAtATime

        }
      );


    return res
      .status(200)
      .json({

        ok:
          true,

        engine:
          "MKAYFX GOLD LIQUIDITY BACKTESTER V1",

        generatedAt:
          new Date()
            .toISOString(),

        data: {

          source:
            "Twelve Data",

          symbol:
            SYMBOL,

          interval:
            INTERVAL,

          totalCandles:
            candles.length,

          firstTimestamp:
            candles[0]?.time ??
            null,

          lastTimestamp:
            last(
              candles
            )?.time ??
            null

        },

        ...result

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

        ok:
          false,

        engine:
          "MKAYFX GOLD LIQUIDITY BACKTESTER V1",

        error:
          error?.message ||
          "Unknown backtest error.",

        generatedAt:
          new Date()
            .toISOString()

      });

  }

}