import { ReviewShell } from './ReviewShell'

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ prUrl?: string }>
}

export default async function ReviewPage({ params, searchParams }: Props) {
  const { id: reviewId } = await params
  const { prUrl } = await searchParams

  return <ReviewShell reviewId={reviewId} prUrl={prUrl ?? ''} />
}
