import Link from 'next/link'
import { LegalPage } from '@/app/_components/legal-page'
import { contact } from '@/app/_components/legal-copy'

export const metadata = { title: 'Contact — Français on Tips' }

export default function ContactPage() {
  return (
    <LegalPage title={contact.title} updated={contact.updated}>
      {contact.body}
      <p className="mt-10">
        <Link href="/" className="font-semibold text-ink underline underline-offset-2">
          &larr; Back to the study material
        </Link>
      </p>
    </LegalPage>
  )
}
