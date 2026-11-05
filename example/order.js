function subtotal(price, quantity) {
  return price * quantity;
}

function delivery(total) {
  if (total >= 10000) return 0;
  return 1000;
}

function discount(total, isMember) {
  if (isMember && total > 5000) return total * 0.9;
  return total;
}

function orderTotal(price, quantity, isMember) {
  const total = subtotal(price, quantity);
  return discount(total, isMember) + delivery(total);
}
