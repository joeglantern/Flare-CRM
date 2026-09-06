/**
 * Typed route targets. TanStack Router wants the route pattern plus params, not an interpolated
 * string, so every deep link in the app goes through here and stays checked at compile time.
 */
export const linkTo = {
  contact: (id: string) => ({ to: '/contacts/$contactId', params: { contactId: id } }) as const,
  company: (id: string) => ({ to: '/companies/$companyId', params: { companyId: id } }) as const,
  lead: (id: string) => ({ to: '/leads/$leadId', params: { leadId: id } }) as const,
  deal: (id: string) => ({ to: '/deals/$dealId', params: { dealId: id } }) as const,
  call: (id: string) => ({ to: '/calls/$callId', params: { callId: id } }) as const,
  conversation: (id: string) =>
    ({ to: '/inbox/$conversationId', params: { conversationId: id } }) as const,
} as const;

/** Plain-string equivalents, for places that store a href (notifications, search results). */
export const hrefTo = {
  contact: (id: string) => `/contacts/${id}`,
  company: (id: string) => `/companies/${id}`,
  lead: (id: string) => `/leads/${id}`,
  deal: (id: string) => `/deals/${id}`,
  call: (id: string) => `/calls/${id}`,
  conversation: (id: string) => `/inbox/${id}`,
} as const;
