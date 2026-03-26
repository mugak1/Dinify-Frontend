import { Component } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Ticket } from 'src/app/_models/app.models';
import { ApiService } from 'src/app/_services/api.service';
import { AuthenticationService } from 'src/app/_services/authentication.service';

@Component({
    selector: 'app-support',
    templateUrl: './support.component.html',
    styleUrl: './support.component.css',
    standalone: false
})
export class SupportComponent {
  tickets: Ticket[] = [];
  ticketForm!: FormGroup;
  showModal=false;
  restaurant?: string;

  constructor(private fb: FormBuilder,private api:ApiService,private auth:AuthenticationService, private route:ActivatedRoute) {
   
    if(auth.currentRestaurantRole?.restaurant_id){
      this.restaurant=auth.currentRestaurantRole?.restaurant_id;
      //this.enc_restaurant=btoa(this.restaurant)
        this.loadTickets();
        this.ticketForm = this.fb.group({
          id: [null],
          ticket_type:['support'],
          ticket_title: ['', Validators.required],
          ticket_description: ['', Validators.required],
          ticket_status: ['open', Validators.required],
          created_at:[Date.now()],
          updated_at:[Date.now()],
          restaurant:[this.restaurant]
        });
    }else 
    if(this.route.parent?.snapshot.params['id']){
      this.restaurant=this.route.parent?.snapshot.params['id'];
      this.ticketForm = this.fb.group({
        id: [null],
        ticket_type:['support'],
        ticket_title: ['', Validators.required],
        ticket_description: ['', Validators.required],
        ticket_status: ['open', Validators.required],
        created_at:[Date.now()],
        updated_at:[Date.now()],
        restaurant:[this.restaurant]
      });
     // this.enc_restaurant=btoa(this.restaurant)
        this.loadTickets();
    }
 
  }

  loadTickets() {
    this.api.get<Ticket>(null,'crm/service-tickets/',{restaurant:this.restaurant}).subscribe((x)=>{
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
      restaurant:this.restaurant
    });
  
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
