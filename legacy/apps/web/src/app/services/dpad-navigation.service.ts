import { Injectable, inject } from '@angular/core';
import { FormFactorService } from './form-factor.service';

/** CSS selector for elements that should be D-pad navigable. */
const FOCUSABLE = [
    '[tabindex="0"]',
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
].join(', ');

/**
 * Handles D-pad / remote control spatial navigation when running in TV mode.
 * Activated by injecting this service in AppComponent.
 *
 * Intercepts arrow key events and moves focus to the nearest focusable element
 * in the pressed direction. Enter and Back/Escape are handled natively or by
 * components.
 */
@Injectable({ providedIn: 'root' })
export class DpadNavigationService {
    private readonly formFactor = inject(FormFactorService);

    constructor() {
        document.addEventListener('keydown', this.onKeydown, true);
    }

    private readonly onKeydown = (event: KeyboardEvent): void => {
        if (!this.formFactor.isTV()) return;

        switch (event.key) {
            case 'ArrowUp':
            case 'ArrowDown':
            case 'ArrowLeft':
            case 'ArrowRight':
                this.moveFocus(event);
                break;
        }
    };

    private moveFocus(event: KeyboardEvent): void {
        const current = document.activeElement as HTMLElement | null;
        const next = this.findNext(current, event.key as string);
        if (next) {
            event.preventDefault();
            next.focus({ preventScroll: false });
            next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }

    private findNext(current: HTMLElement | null, direction: string): HTMLElement | null {
        const all = Array.from(
            document.querySelectorAll<HTMLElement>(FOCUSABLE)
        ).filter(el => {
            // Must be visible and not zero-size
            if (el.offsetParent === null) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

        if (all.length === 0) return null;

        if (!current || !all.includes(current)) {
            return all[0];
        }

        const cr = current.getBoundingClientRect();
        const cx = cr.left + cr.width / 2;
        const cy = cr.top + cr.height / 2;

        const inDirection = all.filter(el => {
            if (el === current) return false;
            const r = el.getBoundingClientRect();
            const ex = r.left + r.width / 2;
            const ey = r.top + r.height / 2;
            // 5px threshold avoids elements at the exact same position
            switch (direction) {
                case 'ArrowDown':  return ey > cy + 5;
                case 'ArrowUp':    return ey < cy - 5;
                case 'ArrowRight': return ex > cx + 5;
                case 'ArrowLeft':  return ex < cx - 5;
                default:           return false;
            }
        });

        if (inDirection.length === 0) return null;

        // Weighted distance: primary axis × 1, secondary axis × 2
        // This prefers elements that are close in the arrow direction over
        // elements that are far away but diagonally aligned.
        return inDirection.sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const ax = ar.left + ar.width / 2;
            const ay = ar.top + ar.height / 2;
            const bx = br.left + br.width / 2;
            const by = br.top + br.height / 2;

            let aDist: number, bDist: number;

            if (direction === 'ArrowDown' || direction === 'ArrowUp') {
                aDist = Math.abs(ay - cy) + Math.abs(ax - cx) * 2;
                bDist = Math.abs(by - cy) + Math.abs(bx - cx) * 2;
            } else {
                aDist = Math.abs(ax - cx) + Math.abs(ay - cy) * 2;
                bDist = Math.abs(bx - cx) + Math.abs(by - cy) * 2;
            }

            return aDist - bDist;
        })[0] ?? null;
    }

    /** Focuses the first focusable element in the document. */
    focusFirst(): void {
        const first = document.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
    }
}
