/**
 * How somebody gets their data deleted, in the order they would actually do it.
 *
 * Meta requires a public URL giving deletion instructions for any app that handles user data, and
 * a person exercising a right under the Data Protection Act needs the same thing. One page serves
 * both, so it has to be specific rather than reassuring: who to ask, what happens, how long it
 * takes, and what survives and why.
 */
import { LegalLayout, List, P, Section } from './LegalLayout';
import { PROVIDER } from './provider';

export function DataDeletion() {
  return (
    <LegalLayout
      title="Deleting your data"
      summary="How to have information about you removed, what happens when you ask, and how long it takes."
    >
      <Section heading="Ask the business you dealt with">
        <P>
          {PROVIDER.service} is used by a business to keep track of the people it deals with. That
          business decides what is kept about you, so a deletion request goes to them first: the
          company whose staff called you, or whose WhatsApp number you wrote to. They can delete
          your record themselves, immediately, from within the software.
        </P>
        <P>
          If you do not know who holds your details, or they do not respond, write to us at{' '}
          <a
            href={`mailto:${PROVIDER.email}`}
            className="underline underline-offset-2 hover:text-text"
          >
            {PROVIDER.email}
          </a>{' '}
          with the phone number or email address you were contacted on. We will identify the
          installation, pass the request to them, and follow it up.
        </P>
      </Section>

      <Section heading="Deleting a WhatsApp conversation">
        <P>
          To have the WhatsApp messages between you and a business removed from its system, send the
          request from, or quoting, the WhatsApp number you messaged from, either to the business or
          to us at the address above. The conversation, its attachments and the phone number it is
          filed under are deleted together. Deleting them here does not delete the copy in your own
          WhatsApp app, which only you can remove.
        </P>
      </Section>

      <Section heading="What happens then">
        <List
          items={[
            'The record is hidden immediately, so no member of staff can see it or act on it.',
            'It is destroyed permanently when the purge period the business has set passes, which is what makes an accidental deletion recoverable in the meantime.',
            'Call recordings and message attachments are deleted with it from file storage.',
            'Nightly backups are kept for fourteen days, so a copy exists in a backup until the last backup taken before the deletion rolls off.',
          ]}
        />
      </Section>

      <Section heading="What is kept, and why">
        <P>
          Two things survive a deletion. The audit log keeps a line saying that a record was deleted
          and by whom, without the record itself, because a log that can be rewritten is not a log.
          Where the business has a legal obligation to keep something, for example an invoice or a
          record required by a regulator, it keeps that and nothing more. If you ask, the business
          must tell you which of the two applies to you.
        </P>
      </Section>

      <Section heading="If you are a member of staff">
        <P>
          Your account belongs to your employer. Ask an administrator to deactivate it: they can do
          that from the settings screen, which signs you out everywhere and stops the account being
          used, while leaving the work you did attributed to you in the record. Removing your name
          from that history is a decision for your employer, since it is their business record.
        </P>
      </Section>

      <Section heading="How long we take">
        <P>
          We acknowledge a request within three working days and complete it within thirty days,
          which is the period the Data Protection Act 2019 allows. If a request is going to take
          longer than that, we tell you why before the thirty days are up.
        </P>
      </Section>

      <Section heading="If you are not satisfied">
        <P>
          You may complain to the{' '}
          <a
            href={PROVIDER.regulator.url}
            className="underline underline-offset-2 hover:text-text"
            rel="noreferrer"
            target="_blank"
          >
            {PROVIDER.regulator.name}
          </a>{' '}
          in {PROVIDER.regulator.country}, or to the supervisory authority where you live.
        </P>
      </Section>
    </LegalLayout>
  );
}
