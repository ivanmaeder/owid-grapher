import * as React from "react"
import * as ReactDOM from "react-dom"

const CookiePreference = ({
    title,
    consent,
    disabled,
    toggleConsent,
    children,
}: {
    title: string
    consent: boolean
    disabled?: boolean
    toggleConsent?: any
    children: React.ReactNode
}) => {
    return (
        <div className="cookie-preference">
            <div className="title">
                {title}
                <input
                    type="checkbox"
                    onChange={toggleConsent}
                    checked={consent}
                    disabled={disabled}
                ></input>
            </div>

            <div className="description">{children}</div>
        </div>
    )
}

export const CookiePreferences = ({
    performance,
    togglePerformance,
}: {
    performance: boolean
    togglePerformance: any
}) => {
    const cookiePreferencesDomSlot = document.querySelector(
        ".wp-block-cookie-preferences"
    )
    if (!cookiePreferencesDomSlot) return null

    return ReactDOM.createPortal(
        <div className="cookie-preferences">
            <CookiePreference
                title="Necessary cookies"
                consent={true}
                disabled={true}
            >
                The website cannot function properly without these cookies. If
                you wish, you can disable cookies completely in your browser
                preferences.
            </CookiePreference>
            <CookiePreference
                title="Performance cookies"
                consent={performance}
                toggleConsent={togglePerformance}
            >
                We use these cookies to monitor and improve website performance.
            </CookiePreference>
        </div>,
        cookiePreferencesDomSlot
    )
}
