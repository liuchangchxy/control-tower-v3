import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type TooltipItem,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import { Card } from './common/Card';
import type { DetailedBenchmarkResult } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

interface ChartDataPoint {
  label: string;
  result: DetailedBenchmarkResult;
}

interface Props {
  data: ChartDataPoint[];
}

const BAR_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#ef4444', // red
  '#a855f7', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#8b5cf6', // violet
];

export function BenchmarkChart({ data }: Props) {
  if (data.length === 0) return null;

  const sortedByTok = [...data].sort((a, b) => b.result.throughputTokPerSec - a.result.throughputTokPerSec);

  const barData = {
    labels: sortedByTok.map(d => d.label),
    datasets: [
      {
        label: 'tok/s',
        data: sortedByTok.map(d => d.result.throughputTokPerSec),
        backgroundColor: sortedByTok.map((_, i) => BAR_COLORS[i % BAR_COLORS.length] + 'cc'),
        borderColor: sortedByTok.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: {
        display: true,
        text: 'Throughput (tok/s)',
        color: '#a1a1aa',
        font: { size: 13, weight: 'normal' as const },
      },
      tooltip: {
        backgroundColor: '#18181b',
        borderColor: '#27272a',
        borderWidth: 1,
        titleColor: '#fafafa',
        bodyColor: '#a1a1aa',
        callbacks: {
          label: (ctx: TooltipItem<'bar'>) => ` ${ctx.parsed.y?.toFixed(1)} tok/s`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#71717a', font: { size: 10 }, maxRotation: 45 },
        grid: { color: '#27272a20' },
      },
      y: {
        ticks: { color: '#71717a' },
        grid: { color: '#27272a40' },
        beginAtZero: true,
      },
    },
  };

  // Line chart: TTFT and total time for each profile
  const lineData = {
    labels: sortedByTok.map(d => d.label),
    datasets: [
      {
        label: 'TTFT (ms)',
        data: sortedByTok.map(d => d.result.ttftMs),
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f630',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#3b82f6',
      },
      {
        label: 'Total Time (ms)',
        data: sortedByTok.map(d => d.result.e2eLatencyMs),
        borderColor: '#22c55e',
        backgroundColor: '#22c55e20',
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointBackgroundColor: '#22c55e',
      },
    ],
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#a1a1aa', font: { size: 11 } },
      },
      title: {
        display: true,
        text: 'Latency Profile',
        color: '#a1a1aa',
        font: { size: 13, weight: 'normal' as const },
      },
      tooltip: {
        backgroundColor: '#18181b',
        borderColor: '#27272a',
        borderWidth: 1,
        titleColor: '#fafafa',
        bodyColor: '#a1a1aa',
        callbacks: {
          label: (ctx: TooltipItem<'line'>) =>
            ` ${ctx.dataset.label ?? ''}: ${ctx.parsed.y?.toFixed(0)}ms`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#71717a', font: { size: 10 }, maxRotation: 45 },
        grid: { color: '#27272a20' },
      },
      y: {
        ticks: { color: '#71717a' },
        grid: { color: '#27272a40' },
        beginAtZero: true,
      },
    },
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Throughput">
        <div className="h-64">
          <Bar data={barData} options={barOptions} />
        </div>
      </Card>

      <Card title="Latency">
        <div className="h-64">
          <Line data={lineData} options={lineOptions} />
        </div>
      </Card>
    </div>
  );
}
