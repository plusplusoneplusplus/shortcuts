pub fn complete_cleanup<E>(
    results: impl IntoIterator<Item = std::result::Result<(), E>>,
) -> std::result::Result<(), E> {
    let mut first_error = None;
    for result in results {
        if let Err(error) = result {
            if first_error.is_none() {
                first_error = Some(error);
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

#[cfg(test)]
mod tests {
    use super::complete_cleanup;

    #[test]
    fn attempts_every_cleanup_and_preserves_the_first_failure() {
        let mut attempted = Vec::new();
        let result = complete_cleanup((0..4).map(|index| {
            attempted.push(index);
            match index {
                1 => Err("controller failed"),
                2 => Err("window failed"),
                _ => Ok(()),
            }
        }));
        assert_eq!(attempted, [0, 1, 2, 3]);
        assert_eq!(result, Err("controller failed"));
    }

    #[test]
    fn successful_and_empty_cleanup_complete() {
        assert_eq!(complete_cleanup::<&str>([Ok(()), Ok(())]), Ok(()));
        assert_eq!(complete_cleanup::<&str>([]), Ok(()));
    }
}
