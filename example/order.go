package main

func subtotal(price int, quantity int) int {
  return price * quantity
}

func delivery(total int) int {
  if total >= 10000 {
    return 0
  }
  return 1000
}

func discount(total int, isMember bool) int {
  if isMember && total > 5000 {
    return total * 0.9
  }
  return total
}

func orderTotal(price int, quantity int, isMember bool) int {
  total := subtotal(price, quantity)
  return discount(total, isMember) + delivery(total)
}
