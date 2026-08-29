import Link from 'next/link'
import { LegalPage } from '@/app/_components/legal-page'
import { refunds } from '@/app/_components/legal-copy'

export const metadata = { title: 'Refunds — Français on Tips' }

export default function RefundsPage() {
  return (
    <LegalPage title={refunds.title} updated={refunds.updated}>
      {refunds.body}
      <p className="mt-10">
        <Link href="/" className="font-semibold text-ink underline underline-offset-2">
          &larr; Back to the study material
        </Link>
      </p>
    </LegalPage>
  )
}
