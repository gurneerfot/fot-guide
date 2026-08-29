/**
 * DRAFTS. Razorpay will not activate a live account without these four pages,
 * so they exist and are linked — but everything in SQUARE BRACKETS is a
 * placeholder that must be replaced with the real business details before you
 * go live, and the policies themselves should be read by someone who knows
 * your obligations. Nothing here is legal advice.
 */

const UPDATED = '28 August 2026'
const ENTITY = '[LEGAL BUSINESS NAME]'
const ADDRESS = '[REGISTERED ADDRESS, CITY, STATE, PIN]'
const SUPPORT_EMAIL = '[support@francaisontips.com]'
const SUPPORT_PHONE = '[+91 XXXXX XXXXX]'

export const terms = {
  title: 'Terms of Service',
  updated: UPDATED,
  body: (
    <>
      <p>
        These terms govern your purchase and use of the study material sold by {ENTITY}
        (&ldquo;Français on Tips&rdquo;, &ldquo;we&rdquo;) through this website.
      </p>

      <h2>What you are buying</h2>
      <p>
        You are buying <strong>online access</strong> to study material, not a
        downloadable file. Access is granted to one account, identified by the access
        code we issue you after payment. The material is readable in your browser for
        as long as your account remains active.
      </p>

      <h2>Your access code</h2>
      <p>
        Your access code is personal to you. It works on{' '}
        <strong>one device at a time</strong> — signing in somewhere new signs you out
        everywhere else. Sharing your code, or attempting to copy, redistribute, resell
        or publish the material, is a breach of these terms and we may disable your
        account without a refund.
      </p>

      <h2>Intellectual property</h2>
      <p>
        All material remains the property of {ENTITY}. Every page you view is watermarked
        with your name and email so that any copy in circulation can be traced to the
        account it came from.
      </p>

      <h2>Availability</h2>
      <p>
        We aim to keep the material available continuously but do not guarantee
        uninterrupted access. We may update or correct the material at any time.
      </p>

      <h2>Contact</h2>
      <p>
        {ENTITY}, {ADDRESS}. Email {SUPPORT_EMAIL}, phone {SUPPORT_PHONE}.
      </p>
    </>
  ),
}

export const privacy = {
  title: 'Privacy Policy',
  updated: UPDATED,
  body: (
    <>
      <p>
        This policy explains what {ENTITY} collects when you buy and read study material
        here, and what we do with it.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>At checkout:</strong> your name, email address and, if you provide it,
        your phone number. <strong>Payment details are never seen by us</strong> — card
        and UPI information goes directly to Razorpay, our payment processor.
      </p>
      <p>
        <strong>While you read:</strong> which pages you open, when, and the IP address
        the request came from. We use this to detect access codes being shared, and for
        nothing else.
      </p>

      <h2>Why we can hold it</h2>
      <p>
        Your name and email are needed to give you access and to send your access code.
        Reading records are kept on the basis of our legitimate interest in preventing
        unauthorised distribution of paid material.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Razorpay (payment processing), our email provider (delivering your access code)
        and our hosting and database providers. We do not sell your data or use it for
        advertising.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Account and purchase records: [RETENTION PERIOD, e.g. seven years, for tax
        purposes]. Reading records: [RETENTION PERIOD, e.g. 12 months].
      </p>

      <h2>Your rights</h2>
      <p>
        Write to {SUPPORT_EMAIL} to ask for a copy of your data, to correct it, or to
        have it deleted. Deleting your account also ends your access to material you
        have bought.
      </p>
    </>
  ),
}

export const refunds = {
  title: 'Refund & Cancellation Policy',
  updated: UPDATED,
  body: (
    <>
      <h2>Digital material</h2>
      <p>
        Access to the study material is granted immediately after payment. Because the
        material is delivered in full the moment your access code is issued, purchases
        are <strong>[REFUNDABLE WITHIN X DAYS / NON-REFUNDABLE]</strong> once you have
        signed in and opened it.
      </p>

      <h2>When we will refund</h2>
      <p>
        We will refund you in full if you were charged more than once for the same
        purchase, if you paid and never received access, or if the material is
        substantially not as described. Write to {SUPPORT_EMAIL} within{' '}
        <strong>[X days]</strong> of your payment with your order details.
      </p>

      <h2>How long it takes</h2>
      <p>
        Approved refunds are returned to the original payment method. Razorpay typically
        takes <strong>[5–7 working days]</strong> to complete the transfer once we have
        issued it.
      </p>

      <h2>Cancellation</h2>
      <p>
        This is a one-time purchase, not a subscription, so there is nothing to cancel
        and you will never be charged again for it.
      </p>
    </>
  ),
}

export const contact = {
  title: 'Contact Us',
  updated: UPDATED,
  body: (
    <>
      <p>We answer within [X working days], usually sooner.</p>

      <h2>Email</h2>
      <p>{SUPPORT_EMAIL}</p>

      <h2>Phone / WhatsApp</h2>
      <p>{SUPPORT_PHONE}</p>

      <h2>Address</h2>
      <p>
        {ENTITY}
        <br />
        {ADDRESS}
      </p>

      <h2>Lost your access code?</h2>
      <p>
        Email us from the address you bought with and we will issue you a new one. Your
        old code stops working when we do.
      </p>
    </>
  ),
}
