import {
    Directive,
    ElementRef,
    HostListener,
    OnInit,
    output,
} from '@angular/core';

/**
 * Makes any element D-pad focusable in TV mode.
 *
 * Usage:
 *   <div appTvFocusable (tvSelect)="onSelect()">...</div>
 *
 * - Adds tabindex="0" so DpadNavigationService can focus it
 * - Enter key emits (tvSelect) — bind this to your click handler
 */
@Directive({
    selector: '[appTvFocusable]',
    host: { tabindex: '0' },
})
export class TvFocusableDirective implements OnInit {
    /** Emitted when the user presses Enter while this element is focused. */
    readonly tvSelect = output<void>();

    constructor(private readonly el: ElementRef<HTMLElement>) {}

    ngOnInit(): void {
        // Ensure the element has a visible focus ring via CSS
        this.el.nativeElement.classList.add('tv-focusable');
    }

    @HostListener('keydown.enter', ['$event'])
    onEnter(event: Event): void {
        event.preventDefault();
        event.stopPropagation();
        this.tvSelect.emit();
    }
}
