//! The left-to-right order courses sit in on the ledger.
//!
//! Name order is the wrong default for a start desk: a club reads its board in
//! the order groups actually go out — 空沼IN, 藻岩OUT, 藻岩IN — which no
//! alphabet produces. The order is the club's, not one operator's, so it is
//! stored per tenant rather than per browser.

use super::CourseId;

/// The tenant's column order, as a list of course ids.
///
/// Partial on purpose. Ordering every course would mean rewriting the whole
/// list whenever one is added, and a course that nobody has placed yet still
/// has to appear on the board.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CourseOrder {
    ids: Vec<CourseId>,
}

impl CourseOrder {
    /// Drops blanks and repeats: a course cannot be in two places at once, and
    /// the first placement is the one somebody chose.
    pub fn new(ids: impl IntoIterator<Item = CourseId>) -> Self {
        let mut seen: Vec<CourseId> = Vec::new();
        for id in ids {
            if id.trim().is_empty() || seen.contains(&id) {
                continue;
            }
            seen.push(id);
        }
        Self { ids: seen }
    }

    pub fn ids(&self) -> &[CourseId] {
        &self.ids
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Where this course sits, or `None` when nobody has placed it.
    pub fn position(&self, course_id: &CourseId) -> Option<usize> {
        self.ids.iter().position(|id| id == course_id)
    }

    /// Sort `items` into board order.
    ///
    /// Placed courses come first in the stored order; everything else follows in
    /// the fallback order the caller supplies. An unplaced course therefore
    /// lands at the end of the board rather than disappearing off it, which is
    /// what a newly created course does before anyone has arranged it.
    pub fn arrange<T>(
        &self,
        items: &mut [T],
        course_id: impl Fn(&T) -> &CourseId,
        fallback: impl Fn(&T, &T) -> std::cmp::Ordering,
    ) {
        items.sort_by(|left, right| {
            match (
                self.position(course_id(left)),
                self.position(course_id(right)),
            ) {
                (Some(a), Some(b)) => a.cmp(&b),
                // Placed beats unplaced, whichever side it is on.
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => fallback(left, right),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn order(ids: &[&str]) -> CourseOrder {
        CourseOrder::new(ids.iter().map(|id| CourseId::new(*id)))
    }

    #[derive(Debug, PartialEq, Eq)]
    struct Column {
        id: CourseId,
        name: String,
    }

    fn column(id: &str, name: &str) -> Column {
        Column {
            id: CourseId::new(id),
            name: name.to_string(),
        }
    }

    fn arranged(order: &CourseOrder, mut columns: Vec<Column>) -> Vec<String> {
        order.arrange(
            &mut columns,
            |column| &column.id,
            |left, right| left.name.cmp(&right.name),
        );
        columns.into_iter().map(|column| column.name).collect()
    }

    #[test]
    fn columns_follow_the_order_the_club_arranged_rather_than_the_alphabet() {
        // The reason this exists: 空沼IN before 藻岩OUT before 藻岩IN is the
        // order groups go out, and no alphabet produces it.
        let order = order(&["karanuma-in", "moiwa-out", "moiwa-in"]);
        let columns = vec![
            column("moiwa-in", "藻岩IN"),
            column("karanuma-in", "空沼IN"),
            column("moiwa-out", "藻岩OUT"),
        ];
        assert_eq!(
            arranged(&order, columns),
            vec!["空沼IN", "藻岩OUT", "藻岩IN"]
        );
    }

    #[test]
    fn a_course_nobody_placed_lands_at_the_end_instead_of_vanishing() {
        // A course created after the board was arranged still has groups on it.
        let order = order(&["b"]);
        let columns = vec![column("a", "A"), column("b", "B"), column("c", "C")];
        assert_eq!(arranged(&order, columns), vec!["B", "A", "C"]);
    }

    #[test]
    fn unplaced_courses_keep_the_fallback_order_among_themselves() {
        let columns = vec![column("c", "C"), column("a", "A"), column("b", "B")];
        assert_eq!(
            arranged(&CourseOrder::default(), columns),
            vec!["A", "B", "C"]
        );
    }

    #[test]
    fn an_id_that_no_longer_names_a_course_moves_nothing() {
        // A deleted course leaves its id in the stored order; the courses around
        // it must keep their places rather than shuffle up.
        let order = order(&["a", "gone", "b"]);
        let columns = vec![column("b", "B"), column("a", "A")];
        assert_eq!(arranged(&order, columns), vec!["A", "B"]);
    }

    #[test]
    fn a_course_named_twice_is_placed_once() {
        let order = order(&["a", "a", "b"]);
        assert_eq!(order.ids(), &[CourseId::new("a"), CourseId::new("b")]);
    }

    #[test]
    fn blank_ids_are_not_positions() {
        // A list built by joining and splitting strings picks up empties.
        let order = CourseOrder::new([CourseId::new(""), CourseId::new("  "), CourseId::new("a")]);
        assert_eq!(order.ids(), &[CourseId::new("a")]);
    }

    #[test]
    fn an_empty_order_places_nothing() {
        assert!(CourseOrder::default().is_empty());
        assert_eq!(CourseOrder::default().position(&CourseId::new("a")), None);
    }
}
