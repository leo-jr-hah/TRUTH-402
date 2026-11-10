const slow = { animationDuration: "2.2s" } as const;

export default function Loading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="space-y-10 pt-4 sm:pt-8"
    >
      <div className="space-y-4">
        <div className="skeleton h-12 w-3/5 max-w-md sm:h-14" style={slow} />
        <div className="skeleton h-5 w-4/5 max-w-lg" style={slow} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="skeleton h-44 rounded-3xl"
            style={{ ...slow, animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="skeleton h-16 rounded-2xl"
            style={{ ...slow, animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
