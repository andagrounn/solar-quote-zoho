// server/zoho/items.js
// Lists active items from Zoho Books for the quote form's item picker.
async function listItems(client) {
  const res = await client.request('GET', '/items?per_page=200&filter_by=Status.Active');
  return (res.items || []).map((i) => ({
    id: i.item_id,
    name: i.name,
    description: i.description || '',
    rate: Number(i.rate) || 0,
    unit: i.unit || '',
  }));
}

module.exports = { listItems };
