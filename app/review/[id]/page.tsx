import { ReviewShell } from './ReviewShell'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ prUrl?: string; mode?: string }>
}

export default async function ReviewPage({ params, searchParams }: Props) {
  const { id: reviewId } = await params
  const { prUrl, mode } = await searchParams

  return (
    <ReviewShell
      reviewId={reviewId}
      prUrl={prUrl ?? ''}
      mode={mode === 'quick' ? 'quick' : 'full'}
    />
  )
}
