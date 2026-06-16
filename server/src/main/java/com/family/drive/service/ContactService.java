package com.family.drive.service;

import com.family.drive.dto.ContactSyncRequest;
import com.family.drive.model.Contact;
import com.family.drive.model.User;
import com.family.drive.repository.ContactRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class ContactService {

    private final ContactRepository contactRepository;
    private final ObjectMapper objectMapper;

    public ContactService(ContactRepository contactRepository, ObjectMapper objectMapper) {
        this.contactRepository = contactRepository;
        this.objectMapper = objectMapper;
    }

    public List<Contact> listContacts(User user) {
        return contactRepository.findByUser(user);
    }

    public void syncContacts(List<ContactSyncRequest> requests, User user) {
        if (requests == null) return;
        for (ContactSyncRequest req : requests) {
            String phonesJson = "[]";
            String emailsJson = "[]";
            try {
                if (req.getPhoneNumbers() != null) {
                    phonesJson = objectMapper.writeValueAsString(req.getPhoneNumbers());
                }
                if (req.getEmails() != null) {
                    emailsJson = objectMapper.writeValueAsString(req.getEmails());
                }
            } catch (JsonProcessingException e) {
                System.err.println("Failed to serialize phone numbers or emails: " + e.getMessage());
            }

            Optional<Contact> existingOpt = contactRepository.findByDeviceContactIdAndUser(req.getDeviceContactId(), user);
            if (existingOpt.isPresent()) {
                Contact contact = existingOpt.get();
                // Update contact details
                contact.setName(req.getName());
                contact.setPhoneNumbers(phonesJson);
                contact.setEmails(emailsJson);
                contact.setLastUpdated(req.getLastUpdated());
                contactRepository.save(contact);
            } else {
                Contact contact = new Contact(
                    user,
                    req.getDeviceContactId(),
                    req.getName(),
                    phonesJson,
                    emailsJson,
                    req.getLastUpdated()
                );
                contactRepository.save(contact);
            }
        }
    }

    public void deleteContact(String deviceContactId, User user) {
        contactRepository.deleteByDeviceContactIdAndUser(deviceContactId, user);
    }
}
