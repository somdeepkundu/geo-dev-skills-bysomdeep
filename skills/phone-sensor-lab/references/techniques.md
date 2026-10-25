# Techniques: the maths and the reasoning

All code is in `assets/template/sensor-lab.js`; every formula here has a test in `scripts/test_sensor_lab.mjs`.
Field notes go at the end of each section as they come in.

## Gravity tilt and its sign

`accelerationIncludingGravity` is the reaction to gravity in device coordinates (x right, y up the screen, z out
of the screen): face-up on a table it reads about (0, 0, +9.81). The rear camera looks along −z, so the angle
between the camera and straight down is `acos(az / |a|)`. With R = Rz(α)·Rx(β)·Ry(γ) this equals the orientation
tilt `acos(cos β · cos γ)` exactly (tested for 8 poses to 1e-6°).

Flipping the sign of the vector turns tilt t into 180° − t. Near 90° those are the same, so `gravitySign()`
only uses pairs where the orientation tilt is more than 20° from 90°, needs 10 of them, and picks a sign only
when one fits better by 10° on average. Reject readings where |a| is more than 35 % away from g: the phone is
being shaken and the vector is not "down".

## Compass vs gyroscope

`rotationRate` is the angular velocity in device coordinates: `alpha` about z, `beta` about x, `gamma` about y,
in °/s. The turn about the world vertical is the component along "up": ω·u with u = a/|a| (device coordinates).
A positive turn is counter-clockwise seen from above, which lowers a clockwise compass heading, so

    d(heading)/dt = −(beta·uₓ + gamma·u_y + alpha·u_z)

`createMagWatch()` integrates that over the last 2 s and compares it with the unwrapped change in compass heading
over the same span. Defaults: window 2 s, tolerance 8°, hold 3 s, needs ≥ 60 % of the window covered.

Why 8°: a phone gyroscope's bias over 2 s is well under 1°, and the compass jitters a few degrees; 8° in 2 s is
far outside both. Tighten it after field data.

What it cannot see: a constant offset (both change together) and a slow drift under about 4°/s. Use a landmark
check for the first (apps/look-check) and a longer window for the second if needed.

Field notes: *(none yet)*. In a Mumbai metro carriage (October 2026) the "slide without turning" and "quarter
turn" hand checks looked consistent at one spot, which says the field there was uniform, not that north was right.

## Stillness

Window 0.6 s; still when the standard deviation of |a| ≤ 0.15 m/s² and the largest gyroscope rate ≤ 5 °/s. The
window must be at least 70 % filled, otherwise the answer is "don't know".

## Steps and dead reckoning

Low-pass the size of the acceleration (factor 0.25), follow a slow baseline (0.02), and call a step at a local
maximum more than 1.0 m/s² above the baseline, at least 300 ms after the previous step. Step length (Weinberg
2002): `K · (aMax − aMin)^(1/4)` over the step, K ≈ 0.48 to start. Calibrate: walk a measured 20 m,
K_new = K × 20 / distance shown.

Fusion is deliberately simple: a GPS fix with accuracy ≤ 10 m moves the dead-reckoned position 30 % of the way
toward it. That keeps the track continuous under trees while stopping unbounded drift in the open.

## Green cover and sky gap

Chromatic coordinates r, g, b = R/(R+G+B), …; Excess Green ExG = 2g − r − b (Woebbecke et al. 1995) ranges from
−1 to 2. Otsu's threshold maximises the between-class variance of the histogram. Floors: ExG 0.05 and brightness
90 stop Otsu from splitting a uniform frame in two. Shares within one frame are robust to auto-exposure; absolute
brightness is not.

Sky gap (pointing up through a canopy) is the share of bright pixels: max(luminance, blue). A wide-angle or
fisheye lens gives the classic hemispherical gap fraction; a phone's normal lens gives a narrower cone, so compare
readings from the same phone and zoom.

## Sound

dBFS = 20 · log₁₀(RMS) of the samples, floor −120. The template smooths with 0.3 and shows the quietest and
loudest smoothed values. Chromium's fake test microphone is silent on the raw path (all voice processing off)
and audible on the processed path; the silence fallback (rule 15) was added because of that, and it would
equally catch a real phone whose raw path is dead.

## NMEA

`$<talker><type>,…*hh`, hh = XOR of every character between `$` and `*`. Latitude `ddmm.mmmm`, longitude
`dddmm.mmmm`, S and W negative. GGA quality: 0 none, 1 GPS, 2 DGPS, 4 RTK fixed, 5 RTK float, 6 dead reckoning.
GST fields 6–7: 1-σ latitude and longitude error (m); horizontal accuracy = hypot of the two.

## Pressure height

International barometric formula `h = 44330 · (1 − (p/p₀)^(1/5.255))`. For a height difference use the
reference reading as p₀. 0.12 hPa ≈ 1 m; a sensor's relative noise sets the useful resolution.

## AR height

In a `local` reference space y is up and gravity-aligned. Viewer pose y minus the hit-test pose y is the camera's
height above the surface it is aimed at. Reject results under 0.1 m or over 30 m.
