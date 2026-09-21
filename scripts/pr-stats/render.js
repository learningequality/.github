const SPARKLINE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function sparkline(values) {
  if (!values || values.length === 0) return '';

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    return SPARKLINE_CHARS[3].repeat(values.length);
  }

  return values
    .map(value => {
      const normalized = (value - min) / (max - min);
      const index = Math.min(
        Math.floor(normalized * SPARKLINE_CHARS.length),
        SPARKLINE_CHARS.length - 1,
      );
      return SPARKLINE_CHARS[index];
    })
    .join('');
}

function histogram(values, numBins = 10) {
  if (!values || values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (max === min) {
    const bins = new Array(numBins).fill(0);
    bins[Math.floor(numBins / 2)] = values.length;
    return bins;
  }

  const logMin = Math.log(min + 1);
  const logMax = Math.log(max + 1);
  const logBinWidth = (logMax - logMin) / numBins;

  const bins = new Array(numBins).fill(0);

  values.forEach(value => {
    const logValue = Math.log(value + 1);
    let binIndex = Math.floor((logValue - logMin) / logBinWidth);
    if (binIndex >= numBins) binIndex = numBins - 1;
    bins[binIndex]++;
  });

  return bins;
}

function distributionSparkline(values, numBins = 10) {
  const bins = histogram(values, numBins);
  return sparkline(bins);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return null;
  if (sortedArr.length === 1) return sortedArr[0];

  const index = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (upper >= sortedArr.length) return sortedArr[sortedArr.length - 1];
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'N/A';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    if (remainingHours > 0) {
      return `${days}d ${remainingHours}h`;
    }
    return `${days}d`;
  }

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${hours}h`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return '<1m';
}

function formatMedianCount(value) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

module.exports = {
  sparkline,
  histogram,
  distributionSparkline,
  percentile,
  formatDuration,
  formatMedianCount,
};
