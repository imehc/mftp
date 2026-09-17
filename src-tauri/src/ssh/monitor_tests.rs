    use super::*;

    #[test]
    fn split_sections_extracts_named_bodies() {
        let output = "login noise\n__MFTP_SEC__ uname\nLinux\n__MFTP_SEC__ load\n0.5 0.4 0.3 1/200 999\n";
        let sections = split_sections(output);
        assert_eq!(sections.get("uname").map(String::as_str), Some("Linux\n"));
        assert_eq!(
            sections.get("load").map(String::as_str),
            Some("0.5 0.4 0.3 1/200 999\n")
        );
        assert!(!sections.contains_key("noise"));
    }

    #[test]
    fn split_sections_keeps_empty_section() {
        let sections = split_sections("__MFTP_SEC__ mem\n__MFTP_SEC__ host\nbox\n");
        assert_eq!(sections.get("mem").map(String::as_str), Some(""));
        assert_eq!(sections.get("host").map(String::as_str), Some("box\n"));
    }

    #[test]
    fn parse_cpu_degrades_on_truncated_input() {
        let cpu = parse_cpu("", "cpu 1 2 3 4 5 6 7 8 9 10");
        assert_eq!(cpu.idle, 100.0);
        assert_eq!(cpu.used, 0.0);
    }

    #[test]
    fn count_cpu_cores_ignores_aggregate_line() {
        let stat = "cpu 1 2 3 4 5\ncpu0 1 2 3 4 5\ncpu1 1 2 3 4 5\nintr 0\n";
        assert_eq!(count_cpu_cores(stat), Some(2));
        assert_eq!(count_cpu_cores("intr 0\n"), None);
    }

    #[test]
    fn monitor_script_warmup_has_double_snapshot() {
        let warm = monitor_script(true);
        assert!(warm.contains("stat0"));
        assert!(warm.contains("sleep 1"));
        assert!(warm.trim_end().ends_with("true"));
        let normal = monitor_script(false);
        assert!(!normal.contains("stat0"));
        assert!(!normal.contains("sleep"));
    }
