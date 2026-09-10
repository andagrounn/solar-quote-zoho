// server/zoho/contacts.js
async function findOrCreateContact(client, customer) {
  let found = null;

  if (customer.email) {
    const byEmail = await client.request(
      'GET',
      `/contacts?email=${encodeURIComponent(customer.email)}`
    );
    found = (byEmail.contacts || [])[0];
  }

  if (!found && customer.name) {
    const byName = await client.request(
      'GET',
      `/contacts?contact_name=${encodeURIComponent(customer.name)}`
    );
    found = (byName.contacts || [])[0];
  }

  if (found) return found.contact_id;

  const created = await client.request('POST', '/contacts', {
    contact_name: customer.name,
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.phone ? { phone: customer.phone } : {}),
  });
  return created.contact.contact_id;
}

module.exports = { findOrCreateContact };
