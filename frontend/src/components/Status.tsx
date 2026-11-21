export function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <div className="lights" aria-hidden><span /><span /><span /><span /><span /></div>
      <span>{text}</span>
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="error" role="alert"><b>Could not load data.</b> {message}</div>
}
