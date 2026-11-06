pub fn base_points(tasks: i32, weight: i32) -> i32 {
  return tasks * weight;
}

pub fn streak_bonus(days: i32) -> i32 {
  if days >= 7 {
    return 50;
  }
  return 0;
}

pub fn peer_multiplier(score: i32, verified: bool) -> i32 {
  if verified && score > 100 {
    return score + 25;
  }
  return score;
}

pub fn final_rating(tasks: i32, weight: i32, days: i32, verified: bool) -> i32 {
  let raw: i32 = base_points(tasks, weight);
  return peer_multiplier(raw, verified) + streak_bonus(days);
}
