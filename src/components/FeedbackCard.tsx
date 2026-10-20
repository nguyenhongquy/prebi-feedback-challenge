interface FeedbackCardProps {
  label: 'A' | 'B'
  paragraphs: string[]
}

export function FeedbackCard({ label, paragraphs }: FeedbackCardProps) {
  return (
    <article aria-labelledby={`feedback-${label}`} className="feedback-card">
      <div className="feedback-card-header">
        <span aria-hidden="true" className={`feedback-letter feedback-letter-${label.toLowerCase()}`}>
          {label}
        </span>
        <h3 id={`feedback-${label}`}>Feedback {label}</h3>
      </div>
      <div className="feedback-copy">
        {paragraphs.map((paragraph, index) => (
          <p key={`${label}-${index}`}>{paragraph}</p>
        ))}
      </div>
    </article>
  )
}
