/**
 * Who the provider is, in one place.
 *
 * These details appear on the public legal pages and are quoted to regulators and to Meta during
 * app review, so they live here rather than being typed out four times and drifting.
 */
export const PROVIDER = {
  /** The product name people see. */
  service: 'Flare CRM',
  /** The entity that operates the service. Replace with the registered company name if it differs. */
  legalName: 'Flare CRM',
  email: 'libanjoe7@gmail.com',
  /** Named to the ICO-equivalent under the Data Protection Act 2019 and to Meta. */
  dataProtectionOfficer: { name: 'Joe Liban', email: 'libanjoe7@gmail.com' },
  address: ['Upperhill', 'Nairobi', '24770-00100', 'Kenya'],
  /** The regulator a person in Kenya complains to, and where. */
  regulator: {
    name: 'Office of the Data Protection Commissioner',
    country: 'Kenya',
    url: 'https://www.odpc.go.ke',
  },
  /** Shown as the effective date on every document; bump it when the text changes materially. */
  updated: '10 September 2026',
} as const;
