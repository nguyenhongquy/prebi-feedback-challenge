interface ResultBar {
  label: string
  count: number
}

interface ResultsBarsProps {
  bars: ResultBar[]
  description: string
  title: string
  total: number
}

export function ResultsBars({
  bars,
  description,
  title,
  total,
}: ResultsBarsProps) {
  return (
    <section aria-label={title} className="results-chart">
      <div className="chart-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="chart-bars">
        {bars.map((bar) => {
          const percentage = total > 0 ? Math.round((bar.count / total) * 100) : 0
          return (
            <div className="chart-row" key={bar.label}>
              <div className="chart-row-label">
                <span>{bar.label}</span>
                <strong>{bar.count} <span className="chart-percent">({percentage} %)</span></strong>
              </div>
              <div
                aria-label={`${bar.label}: ${bar.count} von ${total}, ${percentage} Prozent`}
                className="chart-track"
                role="img"
              >
                <span className="chart-fill" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
