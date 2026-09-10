/**
 * Terms of service, public and unauthenticated.
 *
 * The commercial detail lives in whatever each customer signed; this says the things that are true
 * of every installation, including the ones that are unwelcome to read and worse to discover:
 * what happens when an account is not paid for, what we can reach into during support, and what
 * happens to the data when the arrangement ends.
 */
import { LegalLayout, List, P, Section } from './LegalLayout';
import { PROVIDER } from './provider';

export function Terms() {
  return (
    <LegalLayout
      title="Terms of service"
      summary={`The terms on which ${PROVIDER.legalName} provides ${PROVIDER.service}.`}
    >
      <Section heading="The agreement">
        <P>
          These terms cover the use of {PROVIDER.service}. Where a customer has signed a separate
          order or agreement with us, that document governs price, term and anything else it deals
          with expressly, and these terms fill in the rest.
        </P>
      </Section>

      <Section heading="Accounts">
        <P>
          Each person using the software has their own account, and accounts are not shared. The
          customer is responsible for who they give one to and for removing it when somebody leaves.
          Two-factor authentication is available to every account and we recommend requiring it of
          administrators and managers.
        </P>
      </Section>

      <Section heading="What the customer may use it for">
        <P>Not permitted, on any installation:</P>
        <List
          items={[
            'Sending messages to people who have not agreed to hear from the business, where the law requires their agreement.',
            'Recording calls where the law requires notice or consent that has not been given.',
            'Uploading malware, or content that is unlawful to hold.',
            'Attempting to reach another customer’s installation, or to test ours without written permission.',
            'Reselling access without a written agreement with us.',
          ]}
        />
      </Section>

      <Section heading="Whose data it is">
        <P>
          Everything the customer puts into the software remains theirs. We hold it to run the
          service and for nothing else, as set out in the{' '}
          <a href="/privacy" className="underline underline-offset-2 hover:text-text">
            privacy policy
          </a>
          . They can export it at any time from within the software, without asking us.
        </P>
      </Section>

      <Section heading="Support, and what we can reach">
        <P>
          When a customer asks for help we can do three things inside their installation and no
          more: list who is able to sign in, clear one person&rsquo;s second factor so they can set
          up a new authenticator, and end one person&rsquo;s sessions. We cannot read their
          contacts, calls, messages or deals through that channel, create accounts, or change what
          anybody is allowed to do. Every one of those actions is written into the customer&rsquo;s
          own audit log at the moment it happens, naming us and the reason given.
        </P>
      </Section>

      <Section heading="Availability and changes">
        <P>
          We aim to keep the service available at all times and to schedule upgrades and maintenance
          outside working hours in East Africa, telling the customer beforehand. We may change how
          features work as the product develops; where a change removes something a customer relies
          on, we tell them before it happens.
        </P>
      </Section>

      <Section heading="Payment, and what happens if it stops">
        <P>
          Fees are as agreed in the customer&rsquo;s order. If an account falls unpaid and stays
          unpaid after we have asked, we may put the installation into a read-only state: everything
          already in it can still be read and exported, and nothing new can be written. We do this
          rather than switching the service off, because a business locked out of its own records
          cannot even wind down properly. Nothing is deleted while an account is suspended.
        </P>
      </Section>

      <Section heading="Ending it">
        <P>
          Either side may end the arrangement on the notice set out in the order, or on thirty
          days&rsquo; notice if it says nothing. On the last day the customer may export everything.
          We keep their data for thirty days after that in case they need it again, then delete it,
          and backups containing it roll off within a further fourteen days.
        </P>
      </Section>

      <Section heading="Liability">
        <P>
          Neither side excludes liability for death or personal injury caused by negligence, for
          fraud, or for anything else the law does not allow to be excluded. Beyond that, and to the
          extent the law allows, neither side is liable for lost profit or lost business, and our
          total liability in any twelve-month period is limited to the fees paid for the service in
          that period.
        </P>
      </Section>

      <Section heading="Law">
        <P>
          These terms are governed by the laws of Kenya, and the courts of Kenya have jurisdiction.
        </P>
      </Section>

      <Section heading="Contact">
        <P>
          {PROVIDER.legalName}, {PROVIDER.address.join(', ')}.{' '}
          <a
            href={`mailto:${PROVIDER.email}`}
            className="underline underline-offset-2 hover:text-text"
          >
            {PROVIDER.email}
          </a>
          .
        </P>
      </Section>
    </LegalLayout>
  );
}
