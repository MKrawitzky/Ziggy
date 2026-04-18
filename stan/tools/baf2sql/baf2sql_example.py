
# Opens a BAF analysis and plots some data.
#
# See C# and C++ examples for more usage examples.

import baf2sql
import sqlite3, sys, os
import matplotlib.pyplot as plt, numpy as np

if len(sys.argv) > 1:
    analysis_dir = sys.argv[1]
else:
    raise RuntimeError('Need .d analysis directory as first argument.')

if sys.version_info.major == 2:
    # note: assuming a european Windows here...
    analysis_dir = unicode(analysis_dir, 'cp1252')
    
baf_fn = os.path.join(analysis_dir, "analysis.baf")
sqlite_fn = baf2sql.getSQLiteCacheFilename(baf_fn)
conn = sqlite3.connect(sqlite_fn)

# --- Count spectra
q = conn.execute("SELECT COUNT(*) FROM Spectra "
                 "WHERE LineMzId NOT NULL AND ProfileMzId NOT NULL")
row = q.fetchone()
N = row[0]
print "Specified BAF has {0} spectra with line and profile data.".format(N)

# --- Plot TIC and BPC over MS^1 spectra
q = conn.execute("SELECT Rt, SumIntensity, MaxIntensity FROM Spectra s "
                 "JOIN AcquisitionKeys ak ON s.AcquisitionKey = ak.Id "
                 "WHERE ak.MsLevel = 0 "
                 "ORDER BY s.ROWID")
data = [ row for row in q ]
rt = [ row[0] for row in data ]
tic = [ row[1] for row in data ]
bpc = [ row[2] for row in data ]

plt.figure()
plt.plot(rt, tic)
plt.hold(True)
plt.plot(rt, bpc, '--')
plt.xlabel('retention time / s')
plt.ylabel('intensity / a.u.')
plt.legend(['TIC', 'BPC'])
plt.show()

# --- Plot spectrum with largest base-peak intensity
rt0 = rt[np.argmax(bpc)]
q = conn.execute("SELECT LineMzId, LineIntensityId, ProfileMzId, ProfileIntensityId FROM Spectra "
                 "WHERE ABS(Rt - {0}) < 1e-8".format(rt0))
row = q.fetchone()
if row != None:

    plt.figure()

    bs = baf2sql.BinaryStorage(baf_fn)
    if row[2] != None and row[3] != None:
        profile_mz = bs.readArrayDouble(row[2])
        profile_int = bs.readArrayDouble(row[3])
        plt.plot(profile_mz, profile_int)

    if row[0] != None and row[1] != None:
        line_mz = bs.readArrayDouble(row[0])
        line_int = bs.readArrayDouble(row[1])

        # stem() can take quite some time, so we reduce data for this example:
        max_points = 100;
        if len(line_mz) > max_points:
            line_mz = line_mz[0:max_points]
            line_int = line_int[0:max_points]
        plt.hold(True)
        plt.stem(line_mz, line_int)

    plt.xlabel("m/z / Th")
    plt.ylabel('intensity / a.u.')
    plt.title("Spectrum at RT = {0}s".format(rt0))
    plt.show()
    
else:
    print "No spectrum found..."
