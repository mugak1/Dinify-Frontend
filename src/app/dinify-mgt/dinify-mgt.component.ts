import { AfterViewInit, Component, ElementRef, HostListener, Renderer2, ViewChild, OnDestroy } from '@angular/core';
import { AuthenticationService } from '../_services/authentication.service';

@Component({
    selector: 'app-dinify-mgt',
    templateUrl: './dinify-mgt.component.html',
    styleUrls: ['./dinify-mgt.component.css'],
    standalone: false
})
export class DinifyMgtComponent implements AfterViewInit, OnDestroy {
  @ViewChild('dropdownMenu', { static: false }) dropdownMenu!: ElementRef;
  private dropdownElement!: HTMLElement;
iscollapsed=false;
view_profile=false
/**
 *
 */
constructor(private auth:AuthenticationService, private renderer: Renderer2, private elRef: ElementRef) {
}
ngAfterViewInit(): void {
  this.dropdownElement = this.dropdownMenu?.nativeElement;
  this.renderer.setStyle(this.dropdownElement, 'display', 'none'); // Start hidden
}

logOut(){
  this.auth.logout()
}

toggleProfile(event: Event) {
  this.view_profile = !this.view_profile;

  if (this.view_profile) {
    this.dropdownElement = this.dropdownMenu?.nativeElement;
    this.appendDropdownToBody(event as MouseEvent);
  } else {
    this.removeDropdownFromBody();
  }
   event.stopPropagation(); 
}

@HostListener('document:click', ['$event'])
closeMenu(_event: Event) {
  if (this.view_profile) {
    this.view_profile = false;
    this.renderer.setStyle(this.dropdownElement, 'display', 'none');
    this.removeDropdownFromBody();
  }
}
appendDropdownToBody(event: MouseEvent) {
  if (!this.dropdownElement) return;

  this.renderer.appendChild(document.body, this.dropdownElement);
  this.renderer.setStyle(this.dropdownElement, 'display', 'block');

  // Position dropdown below the button
  const triggerRect = (event.target as HTMLElement).getBoundingClientRect();
  this.renderer.setStyle(this.dropdownElement, 'position', 'absolute');
  this.renderer.setStyle(this.dropdownElement, 'top', `${triggerRect.bottom + window.scrollY}px`);
  this.renderer.setStyle(this.dropdownElement, 'left', `${triggerRect.right - this.dropdownElement.offsetWidth}px`);
  this.renderer.setStyle(this.dropdownElement, 'z-index', '1000');

  // Close dropdown when clicking outside
  setTimeout(() => {
    this.renderer.listen('window', 'click', (e: Event) => {
      if (!this.elRef.nativeElement.contains(e.target)) {
        this.view_profile = false;
        this.renderer.setStyle(this.dropdownElement, 'display', 'none');
        this.removeDropdownFromBody();
      }
    });
  });
}

removeDropdownFromBody() {
  if (this.dropdownElement && document.body.contains(this.dropdownElement)) {
    this.renderer.appendChild(this.elRef.nativeElement, this.dropdownElement);
  }
}

ngOnDestroy(): void {
  this.removeDropdownFromBody();
}
}
