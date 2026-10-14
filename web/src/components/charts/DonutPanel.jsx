import { Link } from 'react-router-dom';
import { DonutChart } from './DonutChart';
import './charts2.css';

/** A donut with a legend that lists every slice with its exact count and share. `data: [{ name, value, color }]`. */
export function DonutPanel({ data, centerLabel, unit, size = 168 }) {
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="donut-panel">
      <DonutChart data={data} size={size} centerLabel={centerLabel} unit={unit} />
      <ul className="donut-legend">
        {data.map((d) => (
          <li key={d.name}>
            <span className="dot" style={{ background: d.color }} />
            {d.to ? <Link to={d.to} className="name">{d.name}</Link> : <span className="name">{d.name}</span>}
            <strong>{d.value.toLocaleString('en-IN')}</strong>
            <span className="share">{total ? `${Math.round((d.value / total) * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
