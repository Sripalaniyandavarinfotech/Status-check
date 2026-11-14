import Header from './Header.jsx';
import { t } from './i18n.js';
import { StatusForm } from './Status.jsx';

const SERVICES = [
  ['TNeDistrict', 'Certificates through the e-District service.'],
  ['TNPDS', 'Ration card requests and changes.'],
  ['Voter', 'Voter registration and corrections.'],
  ['Aadhaar', 'Aadhaar enrolment and updates.'],
  ['PAN', 'New PAN cards and corrections.'],
];

const STEPS = [
  ['Apply with us', 'Bring your details to our office, and we submit your application.'],
  ['We follow it', 'Our team keeps track of your application at every stage.'],
  ['Get the result on WhatsApp', 'When it is approved or rejected, we send you a message.'],
];

// The first page visitors see. Staff who are logged in reach it at /home.
export default function Landing({ user }) {
  const staffLink = user
    ? <a className="btn on-ink" href="/">{t('Open the CRM')}</a>
    : <a className="btn on-ink" href="/login">{t('Staff log in')}</a>;

  return (
    <>
      <Header>{staffLink}</Header>
      <main className="landing">
        <section className="hero">
          <div className="wrap hero-in">
            <div>
              <h1>{t('Your government applications, followed until they are done')}</h1>
              <p>{t('We apply for your certificates, ration card, voter ID, Aadhaar and PAN card, and tell you on WhatsApp when there is news.')}</p>
            </div>
            <div className="hero-check">
              <h2>{t('Check your application')}</h2>
              <StatusForm />
            </div>
          </div>
        </section>

        <section className="wrap land-section" aria-labelledby="services-title">
          <h2 id="services-title">{t('What we help with')}</h2>
          <ul className="land-services">
            {SERVICES.map(([name, text]) => (
              <li key={name}>
                <h3>{t(name)}</h3>
                <p>{t(text)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="wrap land-section" aria-labelledby="steps-title">
          <h2 id="steps-title">{t('How it works')}</h2>
          <ol className="land-steps">
            {STEPS.map(([title, text], i) => (
              <li key={title}>
                <b aria-hidden="true">{i + 1}</b>
                <div>
                  <h3>{t(title)}</h3>
                  <p>{t(text)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="land-foot">
        <div className="wrap">
          <span>{t('eThunaivan')} · {t('by Palaniyandavar Info Tech')}</span>
          <a href={user ? '/' : '/login'}>{t(user ? 'Open the CRM' : 'Staff log in')}</a>
        </div>
      </footer>
    </>
  );
}
