import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiRequest, getToken, setToken, uploadDocument } from "./api.js";
import "./styles.css";

const AuthContext = createContext(null);

const initialState = {
  applications: [],
  notifications: [],
  profile: {
    name: "",
    email: "",
    phone: "",
    idNumber: "",
    vehicle: "",
    plate: "",
  },
  currentDriverId: "",
};

function readSavedState() {
  try {
    const saved = localStorage.getItem("saferoute-state-v2");
    return saved ? { ...initialState, ...JSON.parse(saved) } : initialState;
  } catch {
    return initialState;
  }
}

function AppContent() {
  const [data, setData] = useState(readSavedState);
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  useEffect(() => {
    localStorage.setItem("saferoute-state-v2", JSON.stringify(data));
  }, [data]);
  useEffect(() => {
    const token = getToken();
    if (!token) {
      setSessionReady(true);
      return;
    }
    apiRequest("/me", { token })
      .then(async (result) => {
        setSession(result.user);
        if (result.application) {
          setData((current) => ({
            ...current,
            profile: result.user.profile,
            currentDriverId: result.application.id,
            applications: [result.application, ...current.applications.filter((application) => application.id !== result.application.id)],
          }));
        } else if (result.user.role === "admin") {
          const adminData = await apiRequest("/admin/applications", { token });
          setData((current) => ({
            ...current,
            applications: [...adminData.applications, ...current.applications]
              .filter((application, index, applications) => applications.findIndex((candidate) => candidate.id === application.id) === index),
          }));
        } else if (result.user.role === "school") {
          const schoolData = await apiRequest("/school/drivers", { token });
          setData((current) => ({
            ...current,
            applications: [...schoolData.applications, ...current.applications]
              .filter((application, index, applications) => applications.findIndex((candidate) => candidate.id === application.id) === index),
          }));
        }
      })
      .catch((error) => {
        setToken(null);
        console.error("Could not restore API session:", error);
      })
      .finally(() => setSessionReady(true));
  }, []);

  const updateApplication = (id, update) => setData((current) => ({
    ...current,
    applications: current.applications.map((application) => application.id === id
      ? { ...application, ...update }
      : application),
  }));
  const addNotification = (message, driverId) => setData((current) => ({
    ...current,
    notifications: [{ id: Date.now(), message, driverId, read: false }, ...current.notifications],
  }));
  const updateProfile = (profile) => {
    setSession((current) => current ? { ...current, profile } : current);
    setData((current) => ({
      ...current,
      profile,
      applications: session?.role === "driver"
        ? current.applications.map((application) => application.id === current.currentDriverId
          ? { ...application, ...profile }
          : application)
        : current.applications,
    }));
  };

  return (
    <AuthContext.Provider value={{ session, setSession }}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login setData={setData} setSession={setSession} />} />
      <Route path="/register" element={<Register setData={setData} setSession={setSession} />} />
      <Route path="/driver/dashboard" element={<RequireRole role="driver" session={session} ready={sessionReady}><DriverDashboard data={data} /></RequireRole>} />
      <Route path="/driver/documents" element={<RequireRole role="driver" session={session} ready={sessionReady}><Documents data={data} setData={setData} /></RequireRole>} />
      <Route path="/driver/status" element={<RequireRole role="driver" session={session} ready={sessionReady}><ApplicationStatus data={data} /></RequireRole>} />
      <Route path="/driver/profile" element={<RequireRole role="driver" session={session} ready={sessionReady}><DriverProfile data={data} updateProfile={updateProfile} /></RequireRole>} />
      <Route path="/driver/notifications" element={<RequireRole role="driver" session={session} ready={sessionReady}><Notifications data={data} setData={setData} /></RequireRole>} />
      <Route path="/admin/dashboard" element={<RequireRole role="admin" session={session} ready={sessionReady}><AdminDashboard data={data} /></RequireRole>} />
      <Route path="/admin/verification" element={<RequireRole role="admin" session={session} ready={sessionReady}><VerificationQueue data={data} /></RequireRole>} />
      <Route path="/admin/verification/:id" element={<RequireRole role="admin" session={session} ready={sessionReady}><ReviewApplication data={data} updateApplication={updateApplication} addNotification={addNotification} /></RequireRole>} />
      <Route path="/admin/reports" element={<RequireRole role="admin" session={session} ready={sessionReady}><Reports data={data} /></RequireRole>} />
      <Route path="/school/dashboard" element={<RequireRole role="school" session={session} ready={sessionReady}><SchoolDashboard data={data} /></RequireRole>} />
      <Route path="/school/profile" element={<RequireRole role="school" session={session} ready={sessionReady}><SchoolProfile data={data} updateProfile={updateProfile} /></RequireRole>} />
      <Route path="/school/routes" element={<RequireRole role="school" session={session} ready={sessionReady}><SchoolRoutes data={data} updateApplication={updateApplication} /></RequireRole>} />
      <Route path="/school/drivers/:id" element={<RequireRole role="school" session={session} ready={sessionReady}><SchoolDriver data={data} /></RequireRole>} />
      <Route path="*" element={<Home />} />
    </Routes>
    </AuthContext.Provider>
  );
}

function RequireRole({ role, session, ready, children }) {
  if (!ready) return <main className="auth-content">Loading your secure workspace…</main>;
  if (session?.role !== role) return <Navigate to="/login" replace />;
  return children;
}

function Brand() {
  return <Link to="/" className="logo">SafeRoute <b>Verify</b></Link>;
}

function Home() {
  return (
    <>
      <nav className="top-nav"><Brand /><div className="nav-actions"><Link to="/login">Login</Link><Link to="/register" className="button">Register as a driver</Link></div></nav>
      <main className="landing">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="live-dot" /> SCHOOL TRANSPORT SAFETY PLATFORM</span>
            <h1>Every learner deserves a <em>safer journey.</em></h1>
            <p>One trusted place for schools to find qualified drivers, and for drivers to prove they’re ready to transport learners.</p>
            <div className="hero-actions"><Link to="/register" className="button">Start driver verification <span aria-hidden="true">→</span></Link><Link to="/login" className="button button-outline">Sign in</Link></div>
            <div className="trust-note"><span aria-hidden="true">✓</span> Documents checked. Credentials tracked. Schools informed.</div>
          </div>
          <div className="hero-panel">
              <div className="panel-heading"><span className="shield-icon">▤</span><div><strong>Driver safety file</strong><small>Documents required for review</small></div><span className="pill review">NOT SUBMITTED</span></div>
              <div className="driver-preview"><div className="driver-avatar">DR</div><div><strong>Verification starts with your documents</strong><small>Upload records for officer review</small></div></div>
            <div className="checklist">
                {["Driver's licence", "Professional driving permit", "Vehicle roadworthy", "Police clearance"].map((item) => <div className="check-row" key={item}><span className="check-mark">↑</span><span>{item}</span><b>Upload required</b></div>)}
            </div>
              <div className="panel-foot"><span className="shield-small">●</span> Officers review documents after submission</div>
          </div>
        </section>
        <section className="landing-band">
          <div><strong>Built for everyone responsible for a learner’s journey</strong><p>A clearer process for drivers, verification teams and schools.</p></div>
          <div className="role-cards">
            <RoleCard icon="↗" title="For drivers" text="Apply, upload documents and track your verification." to="/register" action="Create an account" />
            <RoleCard icon="✓" title="For verification officers" text="Review credentials, request documents and manage approvals." to="/login" action="Officer sign in" />
            <RoleCard icon="⌖" title="For schools" text="Find approved drivers and coordinate school routes." to="/login" action="School sign in" />
          </div>
        </section>
        <footer className="landing-footer"><Brand /><span>Safer school transport starts with verified people.</span></footer>
      </main>
    </>
  );
}

function RoleCard({ icon, title, text, to, action }) {
  return <article className="role-card"><span className="role-icon">{icon}</span><h3>{title}</h3><p>{text}</p><Link to={to}>{action} <span aria-hidden="true">→</span></Link></article>;
}

function Login({ setData, setSession }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [role, setRole] = useState("driver");
  const [email, setEmail] = useState(location.state?.email || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const destinations = { driver: "/driver/dashboard", admin: "/admin/dashboard", school: "/school/dashboard" };
  const roleNames = { driver: "Driver", admin: "Verification officer", school: "School" };
  return <AuthFrame title="Welcome back" subtitle="Sign in to continue to your SafeRoute workspace.">
    {location.state?.registered && <p className="inline-success" role="status">Your account is ready. Sign in to continue.</p>}
    <form onSubmit={async (event) => {
      event.preventDefault();
      setError("");
      setSubmitting(true);
      try {
        const result = await apiRequest("/login", { method: "POST", body: { email, password, role } });
        setToken(result.token);
        const serverApplications = result.user.role === "admin"
          ? (await apiRequest("/admin/applications", { token: result.token })).applications
          : result.user.role === "school"
            ? (await apiRequest("/school/drivers", { token: result.token })).applications
            : [];
        setSession(result.user);
        setData((current) => ({
          ...current,
          profile: result.user.profile,
          currentDriverId: result.application?.id || current.currentDriverId,
          applications: [...(result.application ? [result.application] : []), ...serverApplications, ...current.applications]
            .filter((application, index, applications) => applications.findIndex((candidate) => candidate.id === application.id) === index),
        }));
        navigate(destinations[result.user.role]);
      } catch (requestError) {
        setToken(null);
        setSession(null);
        setError(requestError.message);
      } finally {
        setSubmitting(false);
      }
    }}>
      <Field label="Email address"><input type="email" placeholder="you@example.com" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <Field label="Password"><input type="password" placeholder="Enter your password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      <Field label="I am signing in as"><select value={role} onChange={(event) => setRole(event.target.value)}>{Object.entries(roleNames).map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></Field>
      {error && <p className="upload-error" role="alert">{error}</p>}
      <button className="button full-button" disabled={submitting}>{submitting ? "Signing in…" : "Sign in to your account"} <span aria-hidden="true">→</span></button>
    </form>
    <p className="auth-switch">New here? <Link to="/register">Create an account</Link></p>
    <p className="demo-note">Use the email and password you registered with. Verification officer access is provisioned separately.</p>
  </AuthFrame>;
}

function Register({ setData, setSession }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ firstName: "", lastName: "", email: "", phone: "", idNumber: "", vehicle: "", plate: "" });
  const [role, setRole] = useState("driver");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return <AuthFrame title="Create your account" subtitle="Create your account now. Drivers can upload safety documents after signing in.">
    <form onSubmit={async (event) => {
      event.preventDefault();
      setError("");
      setSubmitting(true);
      const cleanProfile = { ...profile, name: `${profile.firstName} ${profile.lastName}`.trim() };
      delete cleanProfile.firstName;
      delete cleanProfile.lastName;
      try {
        const result = await apiRequest("/register", {
          method: "POST",
          body: { ...cleanProfile, password, role },
        });
        setToken(null);
        setSession(null);
        setData((current) => ({
          ...current,
          profile: result.user.profile,
          ...(result.application ? {
            currentDriverId: result.application.id,
            applications: [result.application, ...current.applications.filter((application) => application.id !== result.application.id)],
          } : {}),
        }));
        navigate("/login", { state: { registered: true, email: result.user.profile.email } });
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setSubmitting(false);
      }
    }}>
      <Field label="Account type"><select value={role} onChange={(event) => setRole(event.target.value)}><option value="driver">Driver</option><option value="school">School</option></select></Field>
      <div className="form-grid"><Field label="First name"><input required value={profile.firstName || ""} onChange={(event) => setProfile({ ...profile, firstName: event.target.value })} /></Field><Field label="Last name"><input required value={profile.lastName || ""} onChange={(event) => setProfile({ ...profile, lastName: event.target.value })} /></Field></div>
      <Field label="Email address"><input type="email" required autoComplete="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></Field>
      <Field label="Phone number"><input required value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></Field>
      {role === "driver" && <>
        <div className="form-grid"><Field label="South African ID number"><input required value={profile.idNumber} onChange={(event) => setProfile({ ...profile, idNumber: event.target.value })} /></Field><Field label="Vehicle"><input value={profile.vehicle} onChange={(event) => setProfile({ ...profile, vehicle: event.target.value })} /></Field></div>
        <Field label="Vehicle registration number"><input value={profile.plate} onChange={(event) => setProfile({ ...profile, plate: event.target.value })} /></Field>
      </>}
      <Field label="Password"><input type="password" required minLength="8" autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
      {error && <p className="upload-error" role="alert">{error}</p>}
      <button className="button full-button" disabled={submitting}>{submitting ? "Creating account…" : "Create account"} <span aria-hidden="true">→</span></button>
    </form>
    <p className="auth-switch">Already registered? <Link to="/login">Sign in</Link></p>
  </AuthFrame>;
}

function AuthFrame({ title, subtitle, children }) {
  return <div className="auth-page"><div className="auth-aside"><Brand /><div><span className="eyebrow">SAFER SCHOOL TRANSPORT</span><h2>Confidence for every journey.</h2><p>Verified drivers. Informed schools. Safer learners.</p></div><span className="auth-aside-foot">SafeRoute Verify · Driver credential management</span></div><div className="auth-content"><div className="auth-box"><Link to="/" className="back-link">← Back to home</Link><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>{children}</div></div></div>;
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

const menus = {
  driver: [["Overview", "/driver/dashboard", "⌂"], ["My documents", "/driver/documents", "▤"], ["Application status", "/driver/status", "◷"], ["My profile", "/driver/profile", "◉"], ["Notifications", "/driver/notifications", "♧"]],
  admin: [["Overview", "/admin/dashboard", "⌂"], ["Applications", "/admin/verification", "▤"], ["Reports", "/admin/reports", "▥"]],
  school: [["Approved drivers", "/school/dashboard", "⌕"], ["Route assignments", "/school/routes", "⌖"], ["My profile", "/school/profile", "◉"]],
};

function Portal({ role, title, eyebrow, children }) {
  const { session, setSession } = useContext(AuthContext);
  const roleTitle = { driver: "Driver workspace", admin: "Verification office", school: "School workspace" }[role];
  const initials = (session?.profile?.name || roleTitle)
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const signOut = () => {
    apiRequest("/logout", { method: "POST" }).catch((error) => console.error("Could not end API session:", error));
    setToken(null);
    setSession(null);
  };
  return <div className="portal">
    <aside className="sidebar"><Brand /><div className="workspace-label">WORKSPACE</div><div className="workspace-user"><span className="workspace-avatar">{initials}</span><span><strong>{roleTitle}</strong><small>{role === "driver" ? "Driver account" : role === "admin" ? "Verification officer" : "School account"}</small></span></div><nav className="side-menu">{menus[role].map(([label, href, icon]) => <Link to={href} key={label} className={window.location.pathname.startsWith(href) ? "active" : ""}><span>{icon}</span>{label}</Link>)}</nav><Link to="/login" onClick={signOut} className="signout"><span>↪</span> Sign out</Link><div className="sidebar-foot"><span className="shield-small">✓</span><span>Keeping learner journeys safer</span></div></aside>
    <div className="portal-main"><header className="portal-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div><div className="header-tools">{role === "driver" && <Link to="/driver/notifications" className="header-notifications" aria-label="Notifications">♧<i /></Link>}<span className="header-avatar">{initials}</span></div></header><main className="page-content">{children}</main></div>
  </div>;
}

function StatusPill({ status }) {
  const cls = status === "Approved" || status === "Verified" ? "approved" : status === "Rejected" || status === "Suspended" || status === "Missing" ? "rejected" : status === "Requested" ? "requested" : "review";
  return <span className={`pill ${cls}`}>{status}</span>;
}

function driverApplication(data) {
  return data.applications.find((item) => item.id === data.currentDriverId);
}

function DriverDashboard({ data }) {
  const app = driverApplication(data);
  const verified = app.documents.filter((document) => document.status === "Verified").length;
  const outstanding = app.documents.filter((document) => document.status === "Missing" || document.status === "Requested");
  return <Portal role="driver" title={`Good morning, ${data.profile.name.split(" ")[0] || "Driver"}`} eyebrow="DRIVER OVERVIEW">
    {app.status === "Suspended" && <div className="alert alert-danger"><strong>Account suspended</strong><span>Contact the verification office for details before accepting learner transport assignments.</span></div>}
    <div className="welcome-row"><div><h2>Your safety file, at a glance</h2><p>Keep your credentials up to date to stay ready for school routes.</p></div><Link className="button" to="/driver/documents">Manage documents <span>→</span></Link></div>
    <section className="application-banner"><div className="banner-icon">◷</div><div className="banner-copy"><span className="eyebrow">APPLICATION {app.id}</span><h3>{app.status === "Under review" ? "Your application is being reviewed" : `Application ${app.status.toLowerCase()}`}</h3><p>We’ll notify you when the verification team updates your application.</p></div><StatusPill status={app.status} /><Link to="/driver/status" className="text-link">View progress →</Link></section>
    <div className="metric-grid"><Metric label="Documents verified" value={`${verified} / ${app.documents.length}`} icon="✓" detail="Required credentials" /><Metric label="Documents to action" value={outstanding.length} icon="!" detail="Upload missing documents" /><Metric label="Next expiry" value="18 Nov 2026" icon="◷" detail="Driver's licence" /></div>
    <div className="content-grid">
      <section className="surface"><SectionHeading title="Document checklist" subtitle="Your documents must be current and verified." action={<Link to="/driver/documents" className="text-link">View all →</Link>} /><div className="compact-doc-list">{app.documents.map((document) => <div className="compact-doc" key={document.name}><span className="file-icon">▤</span><span className="compact-doc-name">{document.name}</span><StatusPill status={document.status} />{document.status === "Missing" || document.status === "Requested" ? <Link to="/driver/documents" className="mini-action">Upload</Link> : null}</div>)}</div></section>
      <section className="surface next-steps"><SectionHeading title="Next steps" subtitle="A few ways to keep moving forward." /><Link to="/driver/documents" className="step-link"><span className="step-number">01</span><span><strong>Complete your safety file</strong><small>{outstanding.length ? `${outstanding.length} document${outstanding.length > 1 ? "s" : ""} still needed` : "Your documents are up to date"}</small></span><span>→</span></Link><Link to="/driver/profile" className="step-link"><span className="step-number">02</span><span><strong>Check your contact details</strong><small>Make sure schools can reach you</small></span><span>→</span></Link></section>
    </div>
    <div className="privacy-note"><span>i</span><span><strong>Your information is handled with care.</strong> Verification documents are reviewed by authorised officers and used for school transport safety checks.</span></div>
  </Portal>;
}

function Metric({ label, value, icon, detail }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><small>{detail}</small></div>;
}

function SectionHeading({ title, subtitle, action }) {
  return <div className="section-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>;
}

function Documents({ data, setData }) {
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState("");
  const app = driverApplication(data);
  const onUpload = async (documentName, file) => {
    if (!file) return;
    const validType = ["application/pdf", "image/jpeg", "image/png"].includes(file.type);
    const validExtension = /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(`${documentName} must be 10 MB or smaller.`);
      return;
    }
    if (!validType && !validExtension) {
      setUploadError(`${documentName} must be a PDF, JPG or PNG file.`);
      return;
    }
    setUploadError("");
    setUploading(documentName);
    try {
      const result = await uploadDocument(app.id, documentName, file);
      setData((current) => ({
        ...current,
        applications: current.applications.map((application) => application.id === app.id ? result.application : application),
        notifications: [{ id: Date.now(), message: `${documentName} uploaded and submitted for review.`, driverId: app.id, read: false }, ...current.notifications],
      }));
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploading("");
    }
  };
  return <Portal role="driver" title="My documents" eyebrow="SAFETY FILE"><div className="page-intro"><p>Upload clear, current copies of the documents required to transport learners.</p><span className="required-note"><span>*</span> Required for approval</span></div>
    <section className="surface document-surface"><div className="document-head"><div><h2>Required documents</h2><p>Accepted formats: PDF, JPG or PNG · Maximum size: 10 MB per file</p></div><span className="document-count">{app.documents.filter((document) => document.status === "Verified").length} of {app.documents.length} verified</span></div>
      {uploadError && <p className="upload-error" role="alert">{uploadError}</p>}
      {app.documents.map((document) => <div className="document-row" key={document.name}><span className="file-icon">▤</span><div className="document-info"><strong>{document.name}<span className="required-star">*</span></strong><small>{document.fileName || (document.status === "Verified" ? "Document on file" : "Upload a clear, legible copy")}</small></div><StatusPill status={document.status} /><label className="upload-button">{uploading === document.name ? "Uploading…" : document.status === "Verified" ? "Renew" : document.fileName ? "Replace" : "Upload"}<input type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={Boolean(uploading)} onChange={(event) => { onUpload(document.name, event.target.files[0]); event.target.value = ""; }} /></label></div>)}
    </section><div className="privacy-note"><span>i</span><span>Check expiry dates before uploading. Renewed documents are reviewed before the existing verification is replaced.</span></div>
  </Portal>;
}

function ApplicationStatus({ data }) {
  const app = driverApplication(data);
  const steps = [
    ["Account created", "Your driver profile is registered.", true],
    ["Documents submitted", "Required safety documents have been received.", app.documents.some((item) => item.status !== "Missing")],
    ["Verification in progress", "An officer is checking your documents and credentials.", app.status === "Under review" || app.status === "Approved"],
    [app.status === "Rejected" ? "Changes requested" : "Application decision", app.status === "Approved" ? "Your driver profile is approved for school transport." : app.status === "Rejected" ? "Review officer notes and submit corrected documents." : "We’ll let you know when a decision is made.", app.status === "Approved" || app.status === "Rejected" || app.status === "Suspended"],
  ];
  return <Portal role="driver" title="Application status" eyebrow="APPLICATION">
    <div className="status-summary surface"><div><span className="eyebrow">APPLICATION {app.id}</span><h2>{app.status === "Approved" ? "You’re verified for school transport" : app.status === "Incomplete" ? "Upload your documents to start verification" : "Your application is in progress"}</h2><p>We’ll send an update when there’s a change to your application.</p></div><StatusPill status={app.status} /></div>
    <section className="surface timeline-surface"><SectionHeading title="Verification journey" subtitle="Follow each stage of your application." /><div className="timeline">{steps.map(([title, text, complete], index) => <div className={`timeline-step ${complete ? "complete" : ""}`} key={title}><div className="timeline-marker">{complete ? "✓" : index + 1}</div><div><strong>{title}</strong><p>{text}</p></div></div>)}</div></section>
    <div className="help-banner"><div><strong>Need to update a document?</strong><p>Upload a replacement from your safety file. We’ll notify the verification team.</p></div><Link to="/driver/documents" className="button button-outline">Go to documents</Link></div>
  </Portal>;
}

function DriverProfile({ data, updateProfile }) {
  const [form, setForm] = useState(data.profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(data.profile), [data.profile]);
  return <Portal role="driver" title="My profile" eyebrow="PERSONAL DETAILS"><section className="surface profile-form"><SectionHeading title="Driver information" subtitle="Keep your contact and vehicle details up to date for schools and verification officers." />
    <form onSubmit={async (event) => {
      event.preventDefault();
      setSaved(false);
      setError("");
      setSaving(true);
      try {
        const result = await apiRequest("/profile", { method: "PUT", body: form });
        updateProfile(result.user.profile);
        setSaved(true);
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setSaving(false);
      }
    }}>
      <div className="form-grid"><Field label="Full name"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="ID number"><input required value={form.idNumber} onChange={(event) => setForm({ ...form, idNumber: event.target.value })} /></Field></div>
      <div className="form-grid"><Field label="Email address"><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field><Field label="Phone number"><input required value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field></div>
      <div className="form-grid"><Field label="Vehicle"><input value={form.vehicle} onChange={(event) => setForm({ ...form, vehicle: event.target.value })} /></Field><Field label="Registration number"><input value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value })} /></Field></div>
      {error && <p className="upload-error" role="alert">{error}</p>}
      <div className="form-actions">{saved && <span className="saved-message" role="status">Profile updated.</span>}<button className="button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
    </form></section></Portal>;
}

function SchoolProfile({ data, updateProfile }) {
  const [form, setForm] = useState(data.profile);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(data.profile), [data.profile]);
  return <Portal role="school" title="My profile" eyebrow="SCHOOL DETAILS">
    <section className="surface profile-form"><SectionHeading title="School account information" subtitle="Update the contact details associated with your school account." />
      <form onSubmit={async (event) => {
        event.preventDefault();
        setSaved(false);
        setError("");
        setSaving(true);
        try {
          const result = await apiRequest("/profile", { method: "PUT", body: { ...data.profile, ...form } });
          updateProfile(result.user.profile);
          setSaved(true);
        } catch (requestError) {
          setError(requestError.message);
        } finally {
          setSaving(false);
        }
      }}>
        <Field label="Full name"><input required value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Email address"><input type="email" required value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <Field label="Phone number"><input required value={form.phone || ""} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <div className="form-actions">{saved && <span className="saved-message" role="status">Profile updated.</span>}<button className="button" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button></div>
      </form>
    </section>
  </Portal>;
}

function Notifications({ data, setData }) {
  const currentDriverId = data.currentDriverId;
  const belongsToDriver = (item) => item.driverId === currentDriverId;
  const notifications = data.notifications.filter(belongsToDriver);
  const markRead = () => setData((current) => ({ ...current, notifications: current.notifications.map((item) => belongsToDriver(item) ? { ...item, read: true } : item) }));
  return <Portal role="driver" title="Notifications" eyebrow="UPDATES"><section className="surface"><SectionHeading title="Recent updates" subtitle="Important updates about your application and documents." action={<button className="quiet-button" onClick={markRead}>Mark all as read</button>} />
    <div className="notification-list">{notifications.map((notification) => <div key={notification.id} className={`notification-row ${notification.read ? "read" : ""}`}><span className="notification-dot" /><div><strong>{notification.message}</strong><small>SafeRoute Verify · Recent</small></div>{!notification.read && <span className="new-label">NEW</span>}</div>)}{notifications.length === 0 && <p className="empty-state">You’re all caught up. New updates will appear here.</p>}</div>
  </section></Portal>;
}

function AdminDashboard({ data }) {
  const pending = data.applications.filter((app) => app.status === "Under review").length;
  const approved = data.applications.filter((app) => app.status === "Approved").length;
  const rejected = data.applications.filter((app) => app.status === "Rejected" || app.status === "Suspended").length;
  return <Portal role="admin" title="Verification overview" eyebrow="OFFICER DASHBOARD">
    <div className="welcome-row"><div><h2>Good morning, Verification Officer</h2><p>Review safety files and keep driver records up to date.</p></div><Link to="/admin/reports" className="button button-outline">Download report ↓</Link></div>
    <div className="metric-grid admin-metrics"><Metric label="Total drivers" value={data.applications.length} icon="♙" detail="Registered profiles" /><Metric label="Awaiting review" value={pending} icon="◷" detail="Applications need action" /><Metric label="Approved drivers" value={approved} icon="✓" detail="Eligible for school routes" /><Metric label="Not approved" value={rejected} icon="!" detail="Rejected or suspended" /></div>
    <section className="surface"><SectionHeading title="Applications requiring attention" subtitle="Review documents and record a clear decision." action={<Link to="/admin/verification" className="text-link">View all applications →</Link>} /><ApplicationTable applications={data.applications.filter((app) => app.status === "Under review")} /></section>
    <section className="surface admin-approved"><SectionHeading title="Recently updated" subtitle="Latest driver status changes." /><ApplicationTable applications={data.applications.filter((app) => app.status !== "Under review").slice(0, 3)} /></section>
  </Portal>;
}

function ApplicationTable({ applications, review = true }) {
  if (!applications.length) return <div className="empty-state">No applications in this queue.</div>;
  return <div className="table-wrap"><table><thead><tr><th>DRIVER</th><th>APPLICATION ID</th><th>DOCUMENTS</th><th>STATUS</th><th /></tr></thead><tbody>{applications.map((app) => <tr key={app.id}><td><strong>{app.name}</strong><small>{app.email}</small></td><td>{app.id}</td><td>{app.documents.filter((document) => document.status === "Verified").length} / {app.documents.length} verified</td><td><StatusPill status={app.status} /></td><td>{review ? <Link to={`/admin/verification/${app.id}`} className="table-action">Review →</Link> : <span className="muted">Updated recently</span>}</td></tr>)}</tbody></table></div>;
}

function VerificationQueue({ data }) {
  const [filter, setFilter] = useState("All applications");
  const applications = useMemo(() => data.applications.filter((app) => filter === "All applications" || (filter === "Awaiting review" ? app.status === "Under review" : app.status === filter)), [data.applications, filter]);
  return <Portal role="admin" title="Driver applications" eyebrow="VERIFICATION QUEUE"><div className="queue-toolbar"><p>Review submitted credentials and record verification decisions.</p><select value={filter} onChange={(event) => setFilter(event.target.value)}><option>All applications</option><option>Awaiting review</option><option>Approved</option><option>Rejected</option><option>Suspended</option></select></div><section className="surface"><ApplicationTable applications={applications} /></section></Portal>;
}

function ReviewApplication({ data, updateApplication, addNotification }) {
  const { id } = useParams();
  const app = data.applications.find((item) => item.id === id);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");
  if (!app) return <Portal role="admin" title="Application not found" eyebrow="VERIFICATION"><Link to="/admin/verification" className="text-link">← Back to applications</Link></Portal>;
  const setDocumentStatus = async (name, status) => {
    setError("");
    try {
      if (app.userId) {
        const result = await apiRequest(`/admin/applications/${encodeURIComponent(app.id)}`, {
          method: "PATCH",
          body: { documentName: name, documentStatus: status },
        });
        updateApplication(app.id, result.application);
      } else {
        updateApplication(app.id, { documents: app.documents.map((document) => document.name === name ? { ...document, status } : document) });
      }
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    }
  };
  const requestDocument = async (document) => {
    if (!await setDocumentStatus(document.name, "Requested")) return;
    addNotification(`${document.name} was requested by the verification team.`, app.id);
    setNotice(`${document.name} requested from driver.`);
  };
  const decide = async (status) => {
    setError("");
    try {
      if (app.userId) {
        const result = await apiRequest(`/admin/applications/${encodeURIComponent(app.id)}`, { method: "PATCH", body: { status } });
        updateApplication(app.id, result.application);
      } else {
        updateApplication(app.id, { status });
      }
      addNotification(`Your application status has been updated to ${status}.`, app.id);
      setNotice(`Application ${status.toLowerCase()}.`);
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const downloadDocument = async (documentInfo) => {
    setError("");
    setDownloading(documentInfo.name);
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(documentInfo.fileId)}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Download failed (${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = documentInfo.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDownloading("");
    }
  };
  const allVerified = app.documents.every((document) => document.status === "Verified" && (!app.userId || document.fileId));
  return <Portal role="admin" title="Review driver application" eyebrow="DOCUMENT VERIFICATION">
    <Link to="/admin/verification" className="back-link">← Back to application queue</Link>
    <div className="review-heading"><div><h2>{app.name}</h2><p>Application {app.id} · Submitted for verification</p></div><StatusPill status={app.status} /></div>
    <div className="content-grid review-grid"><div>
      <section className="surface"><SectionHeading title="Required documents" subtitle="Review each credential and mark it verified or request a replacement." />
        {error && <p className="upload-error" role="alert">{error}</p>}
        {app.documents.map((document) => <div className="review-document" key={document.name}><div className="file-icon">▤</div><div className="document-info"><strong>{document.name}</strong><small>{document.fileName || (document.status === "Missing" ? "No file uploaded" : "Uploaded document")}</small></div><StatusPill status={document.status} />{document.fileId && <button className="quiet-button" disabled={downloading === document.name} onClick={() => downloadDocument(document)}>{downloading === document.name ? "Loading…" : "Download"}</button>}<button className="quiet-button" disabled={Boolean(app.userId && (!document.fileId || document.status === "Requested") && document.status !== "Verified")} onClick={() => setDocumentStatus(document.name, document.status === "Verified" ? "Under review" : "Verified")}>{document.status === "Verified" ? "Undo" : "Verify"}</button>{document.status === "Missing" || document.status === "Under review" ? <button className="quiet-button" onClick={() => requestDocument(document)}>Request</button> : null}</div>)}
      </section>
      <section className="surface decision-box"><SectionHeading title="Record a decision" subtitle="Approve only when all required checks are complete." />{notice && <div className="inline-success">{notice}</div>}<div className="decision-actions"><button className="button button-danger" onClick={() => decide(app.status === "Suspended" ? "Approved" : app.status === "Approved" ? "Suspended" : "Rejected")}>{app.status === "Suspended" ? "Reinstate driver" : app.status === "Approved" ? "Suspend driver" : "Reject application"}</button>{app.status !== "Suspended" && app.status !== "Approved" && <button className="button" disabled={!allVerified} title={!allVerified ? "Verify all required documents before approval" : ""} onClick={() => decide("Approved")}>Approve driver</button>}</div>{!allVerified && app.status !== "Approved" && app.status !== "Suspended" && <small className="form-hint">All six required documents must be verified before approval.</small>}</section>
    </div><aside className="surface driver-details"><h3>Driver details</h3><Detail label="Full name" value={app.name} /><Detail label="ID number" value={app.idNumber} /><Detail label="Email" value={app.email} /><Detail label="Phone" value={app.phone} /><Detail label="Vehicle" value={`${app.vehicle} · ${app.plate}`} /><div className="risk-note"><span>i</span> Verify licence and clearance details against the original records.</div></aside></div>
  </Portal>;
}

function Detail({ label, value }) {
  return <div className="detail-row"><small>{label}</small><strong>{value || "Not provided"}</strong></div>;
}

function Reports({ data }) {
  const downloadReport = () => {
    const rows = [["Application ID", "Driver", "Email", "Vehicle", "Status", "Verified documents"], ...data.applications.map((app) => [app.id, app.name, app.email, app.vehicle, app.status, `${app.documents.filter((document) => document.status === "Verified").length}/${app.documents.length}`])];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "saferoute-driver-report.csv";
    link.click();
    URL.revokeObjectURL(url);
  };
  const total = data.applications.length;
  const approved = data.applications.filter((app) => app.status === "Approved").length;
  return <Portal role="admin" title="Reports" eyebrow="DRIVER RECORDS"><div className="welcome-row"><div><h2>Driver verification report</h2><p>Export a snapshot of current driver applications and document completion.</p></div><button className="button" onClick={downloadReport}>Export CSV ↓</button></div>
    <div className="metric-grid"><Metric label="Total applications" value={total} icon="▤" detail="All registered drivers" /><Metric label="Approved" value={approved} icon="✓" detail={`${total ? Math.round(approved / total * 100) : 0}% of applications`} /><Metric label="Under review" value={data.applications.filter((app) => app.status === "Under review").length} icon="◷" detail="Awaiting officer review" /></div>
    <section className="surface"><SectionHeading title="Report preview" subtitle="Export includes current statuses and verified document totals." /><ApplicationTable applications={data.applications} /></section>
  </Portal>;
}

function SchoolDashboard({ data }) {
  const [query, setQuery] = useState("");
  const approved = data.applications.filter((app) => app.status === "Approved");
  const filtered = approved.filter((app) => `${app.name} ${app.vehicle} ${app.plate}`.toLowerCase().includes(query.toLowerCase()));
  return <Portal role="school" title="Find a verified driver" eyebrow="SCHOOL PORTAL"><div className="welcome-row"><div><h2>Safer journeys start with verified drivers.</h2><p>Search approved transport providers and check their current verification status.</p></div><Link className="button button-outline" to="/school/routes">Manage route assignments</Link></div>
    <div className="school-search"><span>⌕</span><input aria-label="Search drivers" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by driver, vehicle or registration number" /><span className="search-count">{filtered.length} approved</span></div>
    <section className="driver-card-grid">{filtered.map((app) => <article className="driver-card surface" key={app.id}><div className="driver-card-top"><div className="driver-avatar">{app.name.split(" ").map((part) => part[0]).join("")}</div><StatusPill status={app.status} /></div><h3>{app.name}</h3><p className="driver-id">{app.id}</p><div className="driver-car"><span>▣</span><span>{app.vehicle}<small>{app.plate}</small></span></div><div className="driver-card-foot"><span>✓ Safety file verified</span><Link to={`/school/drivers/${app.id}`}>View profile →</Link></div></article>)}
      {!filtered.length && <div className="surface empty-state">No approved drivers match your search. Try another name or vehicle.</div>}
    </section><div className="privacy-note"><span>i</span><span>Only drivers with an approved verification status appear in school search results.</span></div>
  </Portal>;
}

function SchoolDriver({ data }) {
  const { id } = useParams();
  const app = data.applications.find((item) => item.id === id && item.status === "Approved");
  const [assigned, setAssigned] = useState(false);
  if (!app) return <Portal role="school" title="Driver not available" eyebrow="APPROVED DRIVERS"><p>This driver profile is not currently approved for school transport.</p><Link to="/school/dashboard" className="text-link">← Return to driver search</Link></Portal>;
  return <Portal role="school" title="Verified driver profile" eyebrow="DRIVER SAFETY FILE"><Link to="/school/dashboard" className="back-link">← Back to approved drivers</Link>
    <section className="surface school-profile"><div className="profile-hero"><div className="driver-avatar large-avatar">{app.name.split(" ").map((part) => part[0]).join("")}</div><div><h2>{app.name}</h2><p>Application {app.id} · {app.vehicle} · {app.plate}</p></div><StatusPill status={app.status} /></div>
      <div className="profile-details-grid"><Detail label="Phone" value={app.phone} /><Detail label="Email" value={app.email} /><Detail label="Vehicle" value={app.vehicle} /><Detail label="Registration" value={app.plate} /></div>
      <SectionHeading title="Safety checks" subtitle="All required credentials have been reviewed by a verification officer." /><div className="compact-doc-list">{app.documents.map((document) => <div className="compact-doc" key={document.name}><span className="check-mark">✓</span><span className="compact-doc-name">{document.name}</span><StatusPill status={document.status} /></div>)}</div>
      <div className="profile-actions">{assigned && <span className="saved-message">Driver added to route assignments.</span>}<Link to={`/school/routes?driver=${app.id}`} className="button" onClick={() => { localStorage.setItem("saferoute-pending-assignment", app.id); setAssigned(true); }}>Assign to a route</Link></div>
    </section></Portal>;
}

function SchoolRoutes({ data, updateApplication }) {
  const eligible = data.applications.filter((app) => app.status === "Approved");
  const [notice, setNotice] = useState("");
  const [route, setRoute] = useState("");
  const [driverId, setDriverId] = useState(() => localStorage.getItem("saferoute-pending-assignment") || eligible[0]?.id || "");
  const assigned = eligible.filter((app) => app.route);
  return <Portal role="school" title="Route assignments" eyebrow="SCHOOL TRANSPORT"><div className="welcome-row"><div><h2>Connect approved drivers to routes</h2><p>Assign a verified driver and keep route coverage visible to your school.</p></div><span className="assignment-count">{assigned.length} active assignment{assigned.length === 1 ? "" : "s"}</span></div>
    <section className="surface assignment-form"><SectionHeading title="Create route assignment" subtitle="Only approved drivers can be assigned." />{notice && <div className="inline-success">{notice}</div>}
      <form onSubmit={(event) => { event.preventDefault(); const driver = eligible.find((app) => app.id === driverId); updateApplication(driverId, { route }); localStorage.removeItem("saferoute-pending-assignment"); setNotice(`${driver.name} assigned to ${route}.`); setRoute(""); }}>
        <div className="form-grid"><Field label="Approved driver"><select required value={driverId} onChange={(event) => setDriverId(event.target.value)}>{eligible.map((driver) => <option value={driver.id} key={driver.id}>{driver.name} · {driver.vehicle}</option>)}</select></Field><Field label="School route"><input required placeholder="e.g. North Campus — Rosebank" value={route} onChange={(event) => setRoute(event.target.value)} /></Field></div>
        <button className="button">Save route assignment</button>
      </form>
    </section>
    <section className="surface assignment-list"><SectionHeading title="Current assignments" subtitle="Drivers currently connected to a school route." />{assigned.length ? assigned.map((app) => <div className="assignment-row" key={app.id}><span className="driver-avatar">{app.name.split(" ").map((part) => part[0]).join("")}</span><div><strong>{app.name}</strong><small>{app.vehicle} · {app.plate}</small></div><span className="route-name">{app.route}</span><StatusPill status={app.status} /></div>) : <div className="empty-state">No route assignments yet. Add an approved driver above.</div>}</section>
  </Portal>;
}

function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}

export default App;
