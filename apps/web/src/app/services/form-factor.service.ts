import { computed, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

/** Breakpoints (px) for form factor detection */
const TABLET_MIN = 600;
const TV_MIN_WIDTH = 960;
const TV_MIN_HEIGHT = 540;

const TV_UA_REGEX =
    /Android TV|AFT|TV\)|GoogleTV|HbbTV|NetCast|Viera|TV Safari|Tizen/i;
const TIZEN_UA_REGEX = /Tizen/i;

/**
 * Detects phone, tablet, and TV form factors for responsive and TV-friendly UI.
 * Used by the single APK to adapt layout and controls for phones, tablets, and Android TV.
 */
@Injectable({ providedIn: 'root' })
export class FormFactorService {
    private readonly width = toSignal(
        fromEvent(window, 'resize').pipe(
            startWith(null),
            map(() => window.innerWidth)
        ),
        { initialValue: window.innerWidth }
    );

    private readonly height = toSignal(
        fromEvent(window, 'resize').pipe(
            startWith(null),
            map(() => window.innerHeight)
        ),
        { initialValue: window.innerHeight }
    );

    /** True when running on a TV-sized or TV-identified device (e.g. Android TV, Tizen). */
    readonly isTV = computed(() => {
        const w = this.width();
        const h = this.height();
        const ua = window.navigator?.userAgent ?? '';
        const isTvUa = TV_UA_REGEX.test(ua);
        const isTvSize = w >= TV_MIN_WIDTH && h >= TV_MIN_HEIGHT && w >= h;
        return isTvUa || isTvSize;
    });

    /** True when running on a Samsung Tizen TV. */
    readonly isTizen = computed(() =>
        TIZEN_UA_REGEX.test(window.navigator?.userAgent ?? '')
    );

    /** True when width is at least tablet breakpoint but not TV. */
    readonly isTablet = computed(() => {
        const w = this.width();
        return w >= TABLET_MIN && !this.isTV();
    });

    /** True when width is below tablet breakpoint. */
    readonly isPhone = computed(() => this.width() < TABLET_MIN);

    /** Current form factor label for layout or debugging. */
    readonly formFactor = computed(() =>
        this.isTV() ? 'tv' : this.isTablet() ? 'tablet' : 'phone'
    );

    /** Current platform runtime. */
    readonly platform = computed<'electron' | 'capacitor' | 'tizen' | 'web'>(() => {
        if (typeof window !== 'undefined' && (window as any).electron) return 'electron';
        if (this.isTizen()) return 'tizen';
        if (typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()) return 'capacitor';
        return 'web';
    });
}
