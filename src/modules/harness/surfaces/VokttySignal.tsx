import styles from "./VokttySignal.module.css";

export function VokttySignal() {
  return (
    <div data-harness-signal aria-hidden="true" className={styles.root}>
      <svg
        className={styles.art}
        viewBox="0 0 1200 220"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
        role="presentation"
        aria-hidden="true"
      >
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M-40 142H382C431 142 460 125 495 91L600 190L705 91C740 125 769 142 818 142H1240"
            className={styles.route}
          />
          <path
            d="M-40 70H336C409 70 459 93 515 137M1240 70H864C791 70 741 93 685 137"
            className={styles.routeSecondary}
          />
          <path
            d="M-40 142H382C431 142 460 125 495 91L600 190L705 91C740 125 769 142 818 142H1240"
            className={styles.trace}
          />
          <path
            d="M-40 70H336C409 70 459 93 515 137M1240 70H864C791 70 741 93 685 137"
            className={`${styles.trace} ${styles.traceReverse}`}
          />
          <path d="M536 34L600 157L664 34" className={styles.mark} />
          <path d="M554 42L600 128L646 42" className={styles.markInner} />
          <path d="M170 56v28m12-28v28m12-28v28m824 0V56m12 28V56m12 28V56" className={styles.ticks} />
        </g>
        <g className={styles.nodes}>
          <circle cx="382" cy="142" r="2.5" />
          <circle cx="495" cy="91" r="2.5" />
          <circle cx="705" cy="91" r="2.5" />
          <circle cx="818" cy="142" r="2.5" />
          <circle cx="600" cy="190" r="3" className={styles.coreNode} />
        </g>
      </svg>
    </div>
  );
}
