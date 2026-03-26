import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Ticket } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';

@Component({
    selector: 'app-mgt-support',
    templateUrl: './mgt-support.component.html',
    styleUrl: './mgt-support.component.css',
    standalone: false
})
export class MgtSupportComponent {
 tickets: Ticket[] = [];
  ticketForm: FormGroup;
  showModal=false;
  status_search:any='';
  title_search:any;

  constructor(private fb: FormBuilder,private api:ApiService) {
    this.ticketForm = this.fb.group({
      id: [null],
      ticket_type:['support'],
      ticket_title: ['', Validators.required],
      ticket_description: ['', Validators.required],
      ticket_status: ['open', Validators.required],
      created_by:[],
      time_created:[],
      resolution_notes:[]
    });
    this.loadTickets();
  }

  loadTickets() {
    this.api.get<Ticket>(null,'crm/service-tickets/',this.status_search?{ticket_status: this.status_search}:{}).subscribe((x)=>{
      this.tickets= x.data?.records as any[];
    })
  }

  addOrUpdateTicket() {
    const formValue = this.ticketForm.value;
    if (formValue.id === null) {
      formValue.id = this.tickets.length + 1;
      this.tickets.push({ ...formValue });
    } else {
      const index = this.tickets.findIndex(ticket => ticket.id === formValue.id);
      if (index !== -1) {
        this.tickets[index] = { ...formValue };
      }
    }
    this.api.postPatch('crm/service-tickets/',formValue,this.ticketForm.get('id')?.value?'put':'post','',{}).subscribe({
      next: ()=>{
        this.loadTickets();
this.closeModal();
    this.resetForm();
      }
      })
    
  }

  editTicket(ticket: Ticket) {
    this.ticketForm.patchValue({
      id: ticket.id,
      ticket_title: ticket.ticket_title,
      ticket_description: ticket.ticket_description,
      ticket_status: ticket.ticket_status,
      created_by: ticket.created_by,
      time_created: ticket.time_created,
      resolution_notes: ticket.resolution_notes,
    });
    this.showModal = true;
  }

  deleteTicket(id: string) {
    this.tickets = this.tickets.filter(ticket => ticket.id !== id);
  }

  resetForm() {
    this.ticketForm.reset({
      id: null,
      ticket_title: '',
      ticket_description: '',
      ticket_status: 'Open',
      created_at:Date.now()
    });
  }
  toggleModal(){
    this.showModal=!this.showModal;
  }
  closeModal(){
    this.showModal=false;
  }
}
