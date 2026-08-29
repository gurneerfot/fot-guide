import Link from 'next/link'
import { LegalPage } from '@/app/_components/legal-page'
import { privacy } from '@/app/_components/legal-copy'

export const metadata = { title: 'Privacy — Français on Tips' }

export default function PrivacyPage() {
  return (
    <LegalPage title={privacy.title} updated={privacy.updated}>
      {privacy.body}
      <p className="mt-10">
        <Link href="/" className="font-semibold text-ink underline underline-offset-2">
          &larr; Back to the study material
        </Link>
      </p>
    </LegalPage>
  )
}
