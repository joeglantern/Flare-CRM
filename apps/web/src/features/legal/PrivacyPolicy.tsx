/**
 * The privacy policy, public and unauthenticated.
 *
 * Written to be true of what the software actually does rather than broad enough to cover
 * anything: the sections on what is held, who else sees it and how long it is kept describe the
 * real tables, the real subprocessors and the real retention job. If the product changes, this
 * changes with it.
 */
import { LegalLayout, List, P, Section } from './LegalLayout';
import { PROVIDER } from './provider';

export function PrivacyPolicy() {
  return (
    <LegalLayout
      title="Privacy policy"
      summary={`How ${PROVIDER.service} handles personal information, and what you can ask us to do with yours.`}
    >
      <Section heading="Who is responsible for your information">
        <P>
          {PROVIDER.service} is customer relationship software licensed to a business, which runs it
          for its own staff and its own customers. That business decides what goes into it and what
          it is used for, which makes them the data controller. {PROVIDER.legalName} operates the
          software on their behalf and is a data processor: we act on their instructions and do not
          use what is in their system for our own purposes.
        </P>
        <P>
          If you are a member of the public who has been in touch with a business that uses{' '}
          {PROVIDER.service}, your first port of call is that business. We will help them answer
          you, and you can write to us directly at{' '}
          <a
            href={`mailto:${PROVIDER.email}`}
            className="underline underline-offset-2 hover:text-text"
          >
            {PROVIDER.email}
          </a>
          .
        </P>
      </Section>

      <Section heading="What the system holds">
        <List
          items={[
            'Contact and company records: names, phone numbers, email addresses, and whatever notes and custom fields the business chooses to keep.',
            'Sales records: leads, deals, tasks and the activity trail against each of them.',
            'Telephone records: who called whom, when, for how long, and call recordings where the business has switched recording on.',
            'Messages: WhatsApp and SMS conversations between the business and the people who write to it, including attachments.',
            'Files uploaded against a record.',
            'Staff accounts: name, email address, role, phone extension, and the times and addresses they signed in from.',
            'An audit log of what each member of staff did, which cannot be edited or deleted by anyone, including administrators.',
          ]}
        />
        <P>
          We do not sell any of it, we do not use it for advertising, and we do not use it to train
          machine learning models.
        </P>
      </Section>

      <Section heading="WhatsApp messages">
        <P>
          Where a business has connected WhatsApp, messages sent to its WhatsApp business number
          arrive through the WhatsApp Business Cloud API operated by Meta and are stored in that
          business&rsquo;s own system so its staff can read and reply to them. The message content,
          the sender&rsquo;s WhatsApp phone number and display name, and any attachment are kept for
          as long as the business keeps its conversation history. Meta processes those messages as
          they pass through its platform under its own terms; we receive them by webhook and store
          them only in the system belonging to the business you wrote to.
        </P>
      </Section>

      <Section heading="What we measure about the software itself">
        <P>
          Each installation reports its own health to us so we can keep it running: how many staff
          accounts are in use, how much storage is used, whether its checks are passing, which
          version it runs and when it last backed up. Those measurements contain no contacts, no
          calls, no messages and no names.
        </P>
      </Section>

      <Section heading="Who else processes it">
        <List
          items={[
            'Google Cloud, which hosts the servers the software runs on.',
            'Meta Platforms, for messages sent and received over the WhatsApp Business Cloud API.',
            'The telephone system connected to the installation, for call signalling and recordings.',
            'The email provider configured for the installation, for notifications, password links and alerts.',
          ]}
        />
        <P>
          Each is used for that one purpose and nothing else. We do not add a processor to an
          existing installation without telling the business that runs it.
        </P>
      </Section>

      <Section heading="How long it is kept">
        <P>
          The business sets its own retention periods and a nightly job enforces them: records past
          their period are removed, and call recordings are deleted on the schedule chosen for them.
          A deleted contact, company or deal is hidden first and destroyed when its purge period
          passes, so an accidental deletion can be undone. Backups are taken nightly and the most
          recent fourteen are kept, so information can persist in a backup for up to fourteen days
          after it is deleted from the live system. The audit log is kept for the life of the
          installation, because a record of who did what is worth nothing if it can be pruned.
        </P>
      </Section>

      <Section heading="Security">
        <P>
          Traffic is encrypted in transit. Passwords are hashed and are visible to nobody, including
          us. Two-factor authentication is available to every account and can be required of
          privileged ones. What each member of staff can see and do is decided by their role, and
          every consequential action, including refusals, is written to the audit log. Access to the
          servers is limited to named administrators.
        </P>
      </Section>

      <Section heading="Cookies">
        <P>
          The application sets one cookie, which keeps you signed in, and remembers your theme
          choice in your own browser. There is no advertising, no analytics tracking and no
          third-party cookie.
        </P>
      </Section>

      <Section heading="Your rights">
        <P>
          Under the Data Protection Act 2019 of {PROVIDER.regulator.country}, and under the General
          Data Protection Regulation where it applies, you may ask for a copy of the personal
          information held about you, ask for it to be corrected, ask for it to be deleted, object
          to how it is used, or ask for it in a portable form. Write to the business you dealt with,
          or to us and we will pass it on and help them answer.
        </P>
        <P>
          Deletion is set out step by step on the{' '}
          <a href="/data-deletion" className="underline underline-offset-2 hover:text-text">
            deleting your data
          </a>{' '}
          page.
        </P>
        <P>
          If you are not satisfied with how a request was handled, you may complain to the{' '}
          <a
            href={PROVIDER.regulator.url}
            className="underline underline-offset-2 hover:text-text"
            rel="noreferrer"
            target="_blank"
          >
            {PROVIDER.regulator.name}
          </a>
          .
        </P>
      </Section>

      <Section heading="Children">
        <P>
          The software is sold to businesses for use by their staff and is not intended for anyone
          under eighteen.
        </P>
      </Section>

      <Section heading="Changes">
        <P>
          When this policy changes materially we update the date at the top of this page and tell
          the businesses that use the software before the change takes effect.
        </P>
      </Section>

      <Section heading="Contact">
        <P>
          Data protection officer: {PROVIDER.dataProtectionOfficer.name},{' '}
          <a
            href={`mailto:${PROVIDER.dataProtectionOfficer.email}`}
            className="underline underline-offset-2 hover:text-text"
          >
            {PROVIDER.dataProtectionOfficer.email}
          </a>
          . Post: {PROVIDER.legalName}, {PROVIDER.address.join(', ')}.
        </P>
      </Section>
    </LegalLayout>
  );
}
